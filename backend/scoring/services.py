"""The score ledger's rules (SRS v0.5 §5.4, §7, D2).

- Writing: every counted hour of a work log, and every verified event, is one ledger row with its points pinned to the configuration
  version in force for that day. Signals keep the rows in step with the hours as they change, within the same request (FR-S2).
- Reading: hours and points on every screen come from these rows (FR-S1), and any number opens the rows behind it (FR-S3).
- Versions: a configuration change makes a new version effective from the current month (FR-S4), so last month's score stays as it
  was (acceptance test 4). Older months change only through recalculate(), which is explicit and audit-logged (§7).

A version's values apply from its month on; something it doesn't know yet (a task added later, then used on an earlier day) takes
the first value it ever had.
"""
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import replace
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from accounts.models import User
from core import audit
from team import calc
from team import services as team
from team.models import METRICS, JobRole, Sheet, SheetEntry, Task, TeamSettings, slot_counts

from .models import EventLog, ScoreLedger, ScoringVersion  # noqa: F401  (ScoringVersion.Kind is used by the importer and snapshots)

BASE_DATE = date(2000, 1, 1)                 # the first version applies to everything before any later one
SRC = ScoreLedger.Source
EV = EventLog.Status
_paused = ContextVar("scoring_paused", default=False)
_actor = ContextVar("scoring_actor", default=None)


class ScoringError(Exception):
    """The request doesn't make sense as asked (HTTP 400)."""


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


@contextmanager
def paused():
    """Bulk writers (the workbook import, a backup restore) stop the row-by-row updates and call adopt() when they finish."""
    token = _paused.set(True)
    try:
        yield
    finally:
        _paused.reset(token)


def set_actor(user):
    """Who a configuration change made in this request is attributed to (FR-C9)."""
    _actor.set(user if getattr(user, "pk", None) else None)


# ---------- configuration versions (FR-S4, FR-C9, §7) ----------

def current_config():
    st = TeamSettings.load()
    return {
        "points": {str(t.id): float(t.points) for t in Task.objects.all()},
        "weights": {str(r.id): r.weights for r in JobRole.objects.all()},
        "sheets": {str(s.id): {"role": s.role_id, "targets": {m: float(getattr(s, "target_" + m)) for m in METRICS},
                               "start": s.start_date.isoformat() if s.start_date else None}
                   for s in Sheet.objects.filter(kind=Sheet.Kind.WORK)},
        "count_weekend": st.count_weekend,
    }


def _num(v):
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


METRIC_LABEL = {"hours": "weekly hours", "points": "monthly points", "leads": "monthly leads", "opps": "monthly opportunities",
                "clients": "monthly clients", "revenue": "monthly revenue"}


def describe(old, new):
    """What changed between two versions, in plain words (FR-C9)."""
    tasks, roles = dict(Task.objects.values_list("id", "name")), dict(JobRole.objects.values_list("id", "name"))
    people = {s.id: s.person or s.name for s in Sheet.objects.all()}
    out = []
    for k in sorted(set(old["points"]) | set(new["points"]), key=int):
        a, b, name = old["points"].get(k), new["points"].get(k), tasks.get(int(k), f"Task {k}")
        if a is None:
            out.append(f"New activity: {name} ({_num(b)} points)")
        elif b is None:
            out.append(f"Activity removed: {name}")
        elif a != b:
            out.append(f"{name}: {_num(a)} → {_num(b)} points")
    for k in sorted(set(old["weights"]) | set(new["weights"]), key=int):
        a, b, name = old["weights"].get(k), new["weights"].get(k), roles.get(int(k), f"Role {k}")
        if a is None:
            out.append(f"New job role: {name}")
        elif b is None:
            out.append(f"Job role removed: {name}")
        elif a != b:
            out.append(f"{name} weights: " + ", ".join(f"{m} {_num(a[m])}% → {_num(b[m])}%" for m in METRICS if a.get(m) != b.get(m)))
    for k in sorted(set(old["sheets"]) | set(new["sheets"]), key=int):
        a, b, name = old["sheets"].get(k), new["sheets"].get(k), people.get(int(k), f"Sheet {k}")
        if a is None:
            out.append(f"New daily log: {name}")
        elif b is None:
            out.append(f"Daily log removed: {name}")
        else:
            out += [f"{name}: {METRIC_LABEL[m]} target {_num(a['targets'][m])} → {_num(b['targets'][m])}" for m in METRICS if a["targets"][m] != b["targets"][m]]
            if a["role"] != b["role"]:
                out.append(f"{name}: job role {roles.get(a['role'], 'none')} → {roles.get(b['role'], 'none')}")
            if a["start"] != b["start"]:
                out.append(f"{name}: start date {a['start'] or 'none'} → {b['start'] or 'none'}")
    if old.get("count_weekend") != new.get("count_weekend"):
        out.append("Hours on weekend days now count" if new.get("count_weekend") else "Hours on weekend days no longer count")
    return out


def _new_version(kind, effective_from, config, changes, user=None, reason=""):
    last = ScoringVersion.objects.select_for_update().order_by("-number").first()
    return ScoringVersion.objects.create(number=(last.number if last else 0) + 1, effective_from=effective_from, kind=kind, config=config,
                                         changes=changes, reason=reason[:300], created_by=user if getattr(user, "pk", None) else None)


def sync_config():
    """Called after any change to activities, roles, daily logs or team rules. Nothing happens unless the configuration really
    changed. A change makes a new version effective from the current month, and this month's rows are priced again. Before anything
    has been scored there is no history to protect, so setting up just amends the latest version."""
    if _paused.get():
        return None
    token = _paused.set(True)             # TeamSettings.load() may save the first row, which would land back here
    try:
        with transaction.atomic():
            cfg = current_config()
            last = ScoringVersion.objects.select_for_update().order_by("-number").first()
            if last is None:
                return ScoringVersion.objects.create(number=1, effective_from=BASE_DATE, kind=ScoringVersion.Kind.BASE, config=cfg)
            if last.config == cfg:
                return None
            if not ScoreLedger.objects.exists():
                last.config = cfg
                last.save(update_fields=["config"])
                return last
            changes = describe(last.config, cfg)
            user = _actor.get()
            frm = calc.month_start(team.today())
            v = _new_version(ScoringVersion.Kind.CONFIG, frm, cfg, changes, user)
            audit.log(user, "scoring.version", v, effective_from=str(frm), changes=changes[:30])
            rebuild(frm)
            return v
    finally:
        _paused.reset(token)


@transaction.atomic
def adopt(kind, user=None, reason=""):
    """After a bulk write (workbook import, backup restore): the new data and configuration apply to all of history."""
    v = _new_version(kind, BASE_DATE, current_config(), [reason] if reason else [], user, reason)
    rebuild()
    return v


class Book:
    """The configuration versions, loaded once for a batch of lookups."""

    def __init__(self, ensure=False):
        self.versions = list(ScoringVersion.objects.order_by("number"))
        if ensure and not self.versions:     # the first write on an empty database
            self.versions = [ScoringVersion.objects.create(number=1, effective_from=BASE_DATE, kind=ScoringVersion.Kind.BASE, config=current_config())]

    def at(self, day):
        found = None
        for v in self.versions:        # by number: the newest version that applies wins
            if v.effective_from <= day:
                found = v
        return found or (self.versions[0] if self.versions else None)

    def _value(self, day, section, key):
        key = str(key)
        v = self.at(day)
        got = v.config[section].get(key) if v else None
        if got is None:
            got = next((x.config[section][key] for x in self.versions if key in x.config[section]), None)
        return got

    def rate(self, day, task_id, live=0.0):
        got = self._value(day, "points", task_id)
        return float(live) if got is None else float(got)

    def rates(self, day):
        """Every activity's points in the month of `day`, as {task id: points}."""
        out = {}
        for v in self.versions:
            for k, p in v.config["points"].items():
                out.setdefault(k, p)
        v = self.at(day)
        return {**out, **(v.config["points"] if v else {})}

    def counts_weekend(self, day):
        v = self.at(day)
        return v.config.get("count_weekend", True) if v else True

    def targets(self, sheet, day):
        """The person's targets for the month of `day`, in the shape of Sheet.targets."""
        got = self._value(day, "sheets", sheet.id)
        if got is None:
            return sheet.targets
        return {**got["targets"], "start": date.fromisoformat(got["start"]) if got["start"] else None}

    def weights(self, sheet, day):
        got = self._value(day, "sheets", sheet.id)
        if got is None:
            return sheet.role.weights if sheet.role else None
        return (self._value(day, "weights", got["role"]) or (sheet.role.weights if sheet.role else None)) if got["role"] else None

    def monthly(self, sheet):
        """For calc.performance: the targets, weights and version number that score a month."""
        def of(ms):
            v = self.at(ms)
            return self.targets(sheet, ms), self.weights(sheet, ms), v.number if v else None
        return of


# ---------- writing the rows (FR-S1, FR-S2) ----------

def source_of(meta, task_id):
    """Where a counted hour came from, from the hour's details (team.planning.log_details)."""
    if meta.get("step"):
        return SRC.STEP
    if meta.get("task"):
        return SRC.TASK
    if meta.get("unplanned"):
        return SRC.UNPLANNED
    if meta.get("planned") is not None:
        return SRC.PLAN if meta["planned"] == task_id else SRC.DEVIATION
    return SRC.LEGACY


def counted_hours(entry, weekend_days, counts_weekend):
    """{slot: (task id, source)}: the hours of a day that count. Pure, so it can be checked on its own."""
    if not counts_weekend and calc.dow(entry.day) in weekend_days:
        return {}
    return {i: (s, source_of(entry.meta_at(i), s)) for i, s in enumerate(entry.slots or []) if slot_counts(s, entry.meta_at(i))}


def _apply(entries, rows):
    """Make the ledger's hour rows match these entries: new hours are added, changed ones re-priced, the rest removed."""
    book, st = Book(ensure=True), TeamSettings.load()
    tasks = {t.id: t for t in Task.objects.all()}
    existing = {(r.sheet_id, r.day, r.slot): r for r in rows}
    create, update = [], []
    for e in entries:
        v = book.at(e.day)
        for slot, (task_id, source) in counted_hours(e, st.weekend_days or [], book.counts_weekend(e.day)).items():
            t = tasks.get(task_id)
            pts = Decimal(str(book.rate(e.day, task_id, t.points if t else 0))).quantize(Decimal("0.01"))
            r = existing.pop((e.sheet_id, e.day, slot), None)
            values = {"member_id": e.sheet.owner_id, "activity_id": task_id if t else None, "activity_name": t.name if t else f"Task {task_id}",
                      "category": (t.type or "Other") if t else "Other", "points": pts, "version_id": v.id, "source": source}
            if r is None:
                create.append(ScoreLedger(sheet_id=e.sheet_id, day=e.day, slot=slot, **values))
            elif any(getattr(r, k) != x for k, x in values.items()):
                for k, x in values.items():
                    setattr(r, k, x)
                r.updated_at = timezone.now()
                update.append(r)
    if existing:
        ScoreLedger.objects.filter(pk__in=[r.pk for r in existing.values()]).delete()
    if create:
        ScoreLedger.objects.bulk_create(create, batch_size=1000)
    if update:
        ScoreLedger.objects.bulk_update(update, ["member", "activity", "activity_name", "category", "points", "version", "source", "updated_at"], batch_size=500)
    return {"added": len(create), "changed": len(update), "removed": len(existing)}


def sync_entry(entry):
    """One day of a work log changed."""
    if _paused.get() or entry.sheet.kind != Sheet.Kind.WORK:
        return
    _apply([entry], ScoreLedger.objects.filter(sheet_id=entry.sheet_id, day=entry.day, slot__isnull=False))


def clear_entry(entry):
    if not _paused.get():
        ScoreLedger.objects.filter(sheet_id=entry.sheet_id, day=entry.day, slot__isnull=False).delete()


def rebuild(frm=None):
    """Price every row from `frm` on again with the version in force for its day."""
    entries = SheetEntry.objects.filter(sheet__kind=Sheet.Kind.WORK).select_related("sheet")
    rows = ScoreLedger.objects.filter(slot__isnull=False)
    events = EventLog.objects.filter(status=EV.VERIFIED).select_related("sheet", "activity")
    if frm:
        entries, rows, events = entries.filter(day__gte=frm), rows.filter(day__gte=frm), events.filter(day__gte=frm)
    out = _apply(list(entries), rows)
    book = Book(ensure=True)
    for ev in events:
        _sync_event(ev, book)
    return out


def sync_owner(sheet):
    """A daily log got another owner: its rows follow."""
    ScoreLedger.objects.filter(sheet=sheet).exclude(member_id=sheet.owner_id).update(member_id=sheet.owner_id)


# ---------- reading the rows ----------

def days_for(sheet_ids, frm=None, to=None):
    """({sheet id: [calc.Day]}, {row id: points}): the shape calc works on. Each hour row is one filled slot; events add points to
    their day without adding hours."""
    qs = ScoreLedger.objects.filter(sheet_id__in=sheet_ids)
    if frm:
        qs = qs.filter(day__gte=frm)
    if to:
        qs = qs.filter(day__lte=to)
    by, pts = defaultdict(dict), {}
    for pk, sheet_id, day, slot, points in qs.order_by("day", "slot").values_list("pk", "sheet_id", "day", "slot", "points"):
        d = by[sheet_id].setdefault(day, calc.Day(day, []))
        if slot is None:
            d.extra = d.extra + float(points)
        else:
            d.slots.append(pk)
            pts[pk] = float(points)
    return {k: list(v.values()) for k, v in by.items()}, pts


def read_cfg(cfg):
    """The ledger already leaves out hours that don't count, so reading it never drops any again."""
    return replace(cfg, count_weekend=True)


def day_totals(sheet_ids, frm, to):
    """{(sheet id, day): {"hours", "points"}} from the ledger."""
    out = {}
    for sheet_id, day, hours, points in (ScoreLedger.objects.filter(sheet_id__in=sheet_ids, day__range=(frm, to)).order_by().values("sheet_id", "day")
                                         .annotate(h=Sum("hours"), p=Sum("points")).values_list("sheet_id", "day", "h", "p")):
        out[(sheet_id, day)] = {"hours": calc.r2(float(hours)), "points": calc.r2(float(points))}
    return out


ZERO = {"hours": 0, "points": 0}


def rows_for(sheet_ids, frm, to, limit=1500):
    """FR-S3: the entries behind a number, with totals and the category and activity analysis (FR-S6)."""
    qs = ScoreLedger.objects.filter(sheet_id__in=sheet_ids, day__range=(frm, to))
    total = qs.aggregate(h=Sum("hours"), p=Sum("points"), n=Count("id"))
    rows = [{"id": r.id, "sheet": r.sheet_id, "person": r.sheet.person or r.sheet.name, "day": r.day, "slot": r.slot, "activity": r.activity.name if r.activity else r.activity_name,
             "category": r.category or "Other", "quantity": r.quantity, "hours": float(r.hours), "points": float(r.points), "source": r.source,
             "source_label": r.get_source_display(), "version": r.version.number, "event": r.event_id}
            for r in qs.select_related("sheet", "activity", "version").order_by("-day", "sheet_id", "slot")[:limit]]
    group = lambda f: [{"name": x[f] or "Other", "hours": calc.r2(float(x["h"])), "points": calc.r2(float(x["p"])), "entries": x["n"]}  # noqa: E731
                       for x in qs.values(f).annotate(h=Sum("hours"), p=Sum("points"), n=Count("id")).order_by("-p", f)]
    return {"rows": rows, "truncated": total["n"] > limit,
            "totals": {"hours": calc.r2(float(total["h"] or 0)), "points": calc.r2(float(total["p"] or 0)), "entries": total["n"]},
            "by_category": group("category"), "by_activity": group("activity_name")}


def kpi_evidence(sheets, frm, to, metric):
    """FR-S3 for a KPI number: the weeks counted in these months, and what each one came from: the records that reached the stage,
    a supervisor's adjustment, numbers typed in, or renewals won."""
    from tracker import kpis as tracker_kpis
    st = TeamSettings.load()
    cfg = team.cfg_of(st)
    months = set()
    m = calc.month_start(frm)
    while m <= to:
        months.add((m.year, m.month))
        m = calc.add_months(m, 1)
    renewals = team.renewal_revenue(cfg) if metric == "revenue" else {}
    rows = []
    for s in sheets:
        person = s.person or s.name
        for k in s.kpis.all():
            if calc.counted_month({"week_start": k.week_start, "counts_in": k.counts_in}) not in months:
                continue
            value = float(getattr(k, metric) or 0)
            if k.source == k.Source.DERIVED and s.owner_id:
                got = tracker_kpis.evidence(s.owner_id, k.week_start, st)["counted"][metric]
                rows += [{"person": person, "sheet": s.id, "week": k.week_start, "day": x["day"], "what": x["company"], "kind": "record", "record": x["id"],
                          "value": float(x["value"]) if metric == "revenue" and x.get("value") is not None else 1} for x in got]
                adj = (k.adjust or {}).get(metric)
                if adj:
                    rows.append({"person": person, "sheet": s.id, "week": k.week_start, "day": None, "what": k.adjust_note or "Supervisor's adjustment", "kind": "adjust", "value": float(adj)})
            elif value:
                rows.append({"person": person, "sheet": s.id, "week": k.week_start, "day": None, "what": "Typed in for the week", "kind": "typed", "value": value})
        for (sheet_id, ws), amount in renewals.items():
            if sheet_id == s.id and calc.month_of_week(ws) in months:
                rows.append({"person": person, "sheet": s.id, "week": ws, "day": None, "what": "Renewals won", "kind": "renewal", "value": float(amount)})
    rows.sort(key=lambda r: (r["week"], r["day"] or r["week"]), reverse=True)
    return {"rows": rows, "totals": {"value": calc.r2(sum(r["value"] for r in rows)), "entries": len(rows)}}


def versions_list():
    return [{"number": v.number, "effective_from": v.effective_from if v.effective_from > BASE_DATE else None, "kind": v.kind, "kind_label": v.get_kind_display(),
             "changes": v.changes, "reason": v.reason, "by": (v.created_by.name or v.created_by.email) if v.created_by else None, "created_at": v.created_at,
             "entries": v.n} for v in ScoringVersion.objects.select_related("created_by").annotate(n=Count("entries")).order_by("-number")[:100]]


# ---------- recalculation (§7) ----------

def _month(value, t):
    try:
        ms = date.fromisoformat(f"{value}-01")
    except (TypeError, ValueError):
        raise ScoringError("Choose a month, like 2026-10.")
    if ms > t:
        raise ScoringError("That month hasn't started yet.")
    return ms


def _scores(years, t):
    """{(sheet id, year, month): (person, points, score)} over these years."""
    out = {}
    for y in years:
        _, rows = team.performance_rows(y, t)
        for r in rows:
            for m in r["months"]:
                if m["state"] != "future":
                    out[(r["id"], y, m["m"])] = (r["person"] or r["name"], m.get("points") or 0, m.get("score"))
    return out


def preview(month):
    """What a recalculation from this month would change, worked out for real and then undone."""
    t = team.today()
    ms = _month(month, t)
    years = range(ms.year, t.year + 1)
    before = _scores(years, t)
    with transaction.atomic():
        _new_version(ScoringVersion.Kind.RECALC, ms, current_config(), [])
        rebuild(ms)
        after = _scores(years, t)
        transaction.set_rollback(True)
    rows = []
    for key, (person, p1, s1) in after.items():
        _, p0, s0 = before.get(key, (person, 0, None))
        if (key[1], key[2]) >= (ms.year, ms.month) and (abs(p1 - p0) > 0.005 or abs((s1 or 0) - (s0 or 0)) > 0.00005):
            rows.append({"person": person, "month": f"{key[1]}-{key[2]:02d}", "points_before": p0, "points_after": p1, "score_before": s0, "score_after": s1})
    rows.sort(key=lambda r: (r["month"], r["person"]))
    return {"from": ms, "rows": rows}


@transaction.atomic
def recalculate(user, month, reason):
    """§7: history changes only here. Today's configuration applies from this month on, as a new version; the audit log has who,
    why and what moved."""
    if not user.is_team_admin:
        raise NotAllowed("Only admins can recalculate history.")
    reason = " ".join((reason or "").split())
    if len(reason) < 3:
        raise ScoringError("Say why history is being recalculated.")
    ms = _month(month, team.today())
    v = _new_version(ScoringVersion.Kind.RECALC, ms, current_config(), [f"Recalculated from {ms:%B %Y} with the configuration of that day"], user, reason)
    moved = rebuild(ms)
    audit.log(user, "scoring.recalculate", v, flagged=True, reason=reason, effective_from=str(ms), **moved)
    return {"version": v.number, "from": ms, **moved}


# ---------- events (D2, FR-T5, §7) ----------

def _sync_event(ev, book=None):
    """A verified event has one ledger row (quantity × the activity's points, no hours); any other has none."""
    if ev.status != EV.VERIFIED:
        ScoreLedger.objects.filter(event=ev).delete()
        return
    book = book or Book(ensure=True)
    v = book.at(ev.day)
    pts = (Decimal(str(book.rate(ev.day, ev.activity_id, ev.activity.points))) * ev.quantity).quantize(Decimal("0.01"))
    ScoreLedger.objects.update_or_create(event=ev, defaults={
        "sheet_id": ev.sheet_id, "member_id": ev.sheet.owner_id, "day": ev.day, "slot": None, "activity_id": ev.activity_id, "activity_name": ev.activity.name,
        "category": ev.activity.type or "Other", "quantity": ev.quantity, "hours": 0, "points": pts, "version_id": v.id, "source": SRC.EVENT})


@transaction.atomic
def log_event(user, sheet, day, activity, quantity, evidence, note=""):
    """Log an event with its evidence. It counts once a supervisor verifies it."""
    block = team.entry_block(user, sheet, day)
    if block:
        raise NotAllowed(block)
    if day > team.today():
        raise ScoringError("An event is logged once it has happened.")
    if sheet.kind != Sheet.Kind.WORK:
        raise ScoringError("Events go on a daily log.")
    if activity.scoring_mode != Task.ScoringMode.EVENT:
        raise ScoringError(f"“{activity.name}” is logged in an hour slot, not as an event.")
    if not activity.active:
        raise ScoringError(f"“{activity.name}” is switched off.")
    if not user.is_team_admin and not (sheet.role and sheet.role.tasks.filter(pk=activity.pk).exists()):
        raise ScoringError(f"“{activity.name}” isn't one of your job role's activities.")
    if activity.counts_as_win and team.kpi_derived(TeamSettings.load()):
        raise ScoringError("A work order counts when your supervisor verifies the win in your pipeline. Mark the record as Won.")
    evidence = " ".join((evidence or "").split())
    if len(evidence) < 3:
        raise ScoringError("Add the evidence: a reference or link your supervisor can check.")
    ev = EventLog.objects.create(sheet=sheet, day=day, activity=activity, quantity=quantity, evidence=evidence[:300], note=(note or "").strip()[:500], by=user)
    audit.log(user, "event.log", activity.name, person=sheet.person or sheet.name, day=str(day), quantity=quantity)
    return ev


@transaction.atomic
def decide_event(user, ev, verified, note=""):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins verify events.")
    if ev.sheet.owner_id == user.pk:
        raise NotAllowed("Someone else verifies your own events.")
    if ev.record_id:
        raise ScoringError("This event follows the win in the pipeline. Verify or send back the win there.")
    note = " ".join((note or "").split())
    if not verified and len(note) < 3:
        raise ScoringError("Say why it isn't verified, so the person can fix it.")
    ev.status, ev.decided_by, ev.decided_at, ev.decision_note = (EV.VERIFIED if verified else EV.REJECTED), user, timezone.now(), note[:300]
    ev.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    _sync_event(ev)
    audit.log(user, "event.verify" if verified else "event.reject", ev.activity.name, person=ev.sheet.person or ev.sheet.name, day=str(ev.day), note=note[:200])
    return ev


@transaction.atomic
def withdraw_event(user, ev):
    if ev.sheet.owner_id != user.pk and not user.is_team_admin:
        raise NotAllowed("This event belongs to someone else.")
    if ev.status != EV.PENDING:
        raise ScoringError("Only an event still waiting for verification can be withdrawn.")
    audit.log(user, "event.withdraw", ev.activity.name, day=str(ev.day))
    ev.delete()


def win_task():
    return Task.objects.filter(scoring_mode=Task.ScoringMode.EVENT, counts_as_win=True, active=True).order_by("position", "id").first()


def record_win(user, record):
    """FR-K2, D2: a supervisor verifying a win is the verification of its work order event, so it counts once, in one place."""
    task, sheet = win_task(), Sheet.objects.filter(owner_id=record.owner_id, kind=Sheet.Kind.WORK, archived=False).order_by("position", "id").first()
    if task is None or sheet is None:
        return None
    ev = EventLog.objects.filter(record=record, activity=task).first() or EventLog(record=record, activity=task, by=user)
    ev.sheet, ev.day, ev.quantity, ev.status = sheet, record.stage_since or team.today(), 1, EV.VERIFIED
    ev.evidence, ev.decided_by, ev.decided_at, ev.decision_note = f"Win verified: {record.company}"[:300], user, timezone.now(), ""
    ev.save()
    _sync_event(ev)
    return ev


def withdraw_win(user, record, why=""):
    """The win is no longer verified, or the record left Won: its points go with it."""
    for ev in EventLog.objects.filter(record=record, status=EV.VERIFIED).select_related("sheet", "activity"):
        ev.status, ev.decided_by, ev.decided_at, ev.decision_note = EV.REJECTED, user if getattr(user, "pk", None) else None, timezone.now(), why[:300]
        ev.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
        _sync_event(ev)


def events_for(user, scope="mine", status=None, sheet=None, frm=None, to=None):
    qs = EventLog.objects.select_related("sheet", "activity", "decided_by", "record")
    if scope == "team":
        if not (user.can_approve or user.role == User.Role.VIEWER):
            raise NotAllowed("Only supervisors, management and admins see the team's events.")
    elif sheet is None:
        qs = qs.filter(sheet__owner=user)
    if sheet is not None:
        qs = qs.filter(sheet_id=sheet)
    if status:
        qs = qs.filter(status=status)
    if frm:
        qs = qs.filter(day__gte=frm)
    if to:
        qs = qs.filter(day__lte=to)
    return qs
