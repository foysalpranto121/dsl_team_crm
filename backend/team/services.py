"""Team sheet rules: who may change what (including the midnight lock), saving entries, and building the numbers."""
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from core import audit

from . import calc
from .models import SLOTS, JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings, WeekPlan


class Locked(Exception):
    """The change isn't allowed; the message says why in plain words."""


def now():
    return timezone.now()  # patched in tests


def today(st=None):
    st = st or TeamSettings.load()
    return calc.today_in(st.timezone, now())


def cfg_of(st):
    return calc.Cfg(week_start_dow=st.week_start_dow, weekend_days=frozenset(st.weekend_days), count_weekend=st.count_weekend)


# ---------- who may change what ----------

def plan_statuses(sheet, frm, to, cfg):
    """{week start: weekly-plan status} for the weeks from frm to to. For a plan sheet, its own weeks; for a work log, the
    weeks of its owner's plan (the plan that opens the work)."""
    if sheet.kind == Sheet.Kind.PLAN:
        qs = WeekPlan.objects.filter(sheet=sheet)
    elif sheet.owner_id:
        qs = WeekPlan.objects.filter(sheet__owner_id=sheet.owner_id, sheet__kind=Sheet.Kind.PLAN, sheet__archived=False)
    elif sheet.person:
        qs = WeekPlan.objects.filter(sheet__owner__isnull=True, sheet__kind=Sheet.Kind.PLAN, sheet__person__iexact=sheet.person)
    else:
        return {}
    out = {}
    for ws, status in qs.filter(week_start__range=(calc.week_start_of(frm, cfg), to)).values_list("week_start", "status"):
        if out.get(ws) != WeekPlan.Status.APPROVED:   # with two plan sheets, an approved one wins
            out[ws] = status
    return out


def entry_block(user, sheet, day, st=None, plans=None):
    """None if the person may change this sheet on this day, otherwise the reason they can't.
    plans: plan_statuses() for the weeks around `day`, when the caller checks many days at once."""
    if user.is_team_admin:
        return None
    if not user.does_own_work:
        return "Management can look at sheets but not change them."
    if sheet.archived:
        return "This sheet is archived."
    if sheet.owner_id != user.pk:
        return "You can only fill in your own sheet."
    st = st or TeamSettings.load()
    if st.lock_days:
        t = today(st)
        if day < t:
            return f"This day is locked. Days lock at midnight ({st.timezone} time). Ask an admin if it needs a correction."
        if sheet.kind == Sheet.Kind.WORK and day > t:
            return "You can only log today. Plan ahead in My Day → Plan."
    # Plans close at the cut-off (SRS v0.5 FR-P6). Which hours of a plan may still change is decided per hour when saving:
    # submitted and approved hours are locked (FR-P2, FR-P3). Logging work is never blocked by the plan (D1, FR-T3).
    if sheet.kind == Sheet.Kind.PLAN:
        from .planning import plan_closed   # planning builds on this module, so it's imported here
        return plan_closed(day, st)
    return None


def kpi_derived(st, week_start=None):
    """SRS v0.5 FR-K2/K5: weekly KPIs are worked out from the pipeline (unless the team switched to typing them in); weeks
    before the cut-over date keep the numbers typed in."""
    if st.kpi_mode != TeamSettings.KpiMode.DERIVED:
        return False
    return week_start is None or st.kpi_from is None or week_start >= st.kpi_from


def kpi_block(user, sheet, week_start, st=None):
    """Why the signed-in person can't type this week's numbers (None = they can)."""
    st = st or TeamSettings.load()
    if calc.dow(week_start) != st.week_start_dow:
        return "A week must start on the team's first day of the week."
    if sheet.kind != Sheet.Kind.WORK:
        return "Weekly results go on work-log sheets, not plans."
    if kpi_derived(st, week_start):
        return "Worked out from the pipeline: move records through the stages. A supervisor can adjust the week with a note."
    if user.is_team_admin:
        return None
    if not user.does_own_work:
        return "Management can look at results but not change them."
    if sheet.archived:
        return "This sheet is archived."
    if sheet.owner_id != user.pk:
        return "You can only enter results for your own sheet."
    if st.lock_days and not (week_start <= today(st) <= week_start + timedelta(days=6)):
        return "Only this week's results can be changed. Ask an admin to correct an earlier week."
    return None


# ---------- saving ----------

def clean_slots(user, sheet, slots, previous):
    """Up to 10 hour slots, each a task id or empty. Members may only pick active tasks of their job role;
    a slot they don't change keeps its task even if it was later switched off."""
    if not isinstance(slots, list) or len(slots) > SLOTS:
        raise Locked(f"Send at most {SLOTS} hour slots.")
    slots = [None if s in (None, "", 0) else s for s in slots] + [None] * (SLOTS - len(slots))
    ids = {s for s in slots if s is not None}
    if any(not isinstance(s, int) for s in ids):
        raise Locked("Each hour slot must be a task.")
    known = {t.id: t for t in Task.objects.filter(id__in=ids)}
    if ids - known.keys():
        raise Locked("One of the chosen tasks no longer exists.")
    prev = (previous or []) + [None] * SLOTS
    for i, s in enumerate(slots):          # SRS v0.5 D2, FR-T5: an event isn't an hour of work, and counts once it's verified
        if s is not None and s != prev[i] and known[s].scoring_mode == Task.ScoringMode.EVENT:
            raise Locked(f'"{known[s].name}" is an event, not an hour of work. Log it as an event, with its evidence, so a supervisor can verify it.')
    if not user.is_team_admin:
        allowed = set(sheet.role.tasks.filter(active=True).values_list("id", flat=True)) if sheet.role else set()
        for i, s in enumerate(slots):
            if s is not None and s != prev[i] and s not in allowed:
                raise Locked(f'"{known[s].name}" isn\'t one of your job role\'s tasks.')
    while slots and slots[-1] is None:
        slots.pop()
    return slots


@transaction.atomic
def save_entry(user, sheet, day, slots, remarks, meta=None):
    """Save one day of a sheet.
    Plan: submitted and approved hours stay as they are; a rejected hour that's changed becomes a draft (SRS v0.5 FR-P2/P3).
    Work log: each hour is compared with the approved plan (FR-T1–T3, §6). A different task is a deviation: it needs a
    reason and counts zero until a supervisor approves it. An unplanned hour counts provisionally (or waits for approval in
    strict mode). An approved hour can be marked Not done, with a reason."""
    from . import planning   # planning builds on this module, so it's imported here

    st = TeamSettings.load()
    reason = entry_block(user, sheet, day, st)
    if reason:
        raise Locked(reason)
    entry = SheetEntry.objects.select_for_update().filter(sheet=sheet, day=day).first()
    slots = clean_slots(user, sheet, slots, entry.slots if entry else None)
    remarks = (remarks or "").strip()[:2000]
    if sheet.kind == Sheet.Kind.PLAN:
        planning.guard_plan_change(user, sheet, day, entry.slots if entry else [], slots)
        details = []
    else:
        slots, details = planning.log_details(user, sheet, day, slots, meta, entry, st)
    correction = user.is_team_admin and st.lock_days and day < today(st)   # an admin changing a locked day
    if not calc.filled(slots) and not remarks and not details:
        if entry:
            entry.delete()
            audit.log(user, "entry.clear", sheet, flagged=correction, day=str(day))
        return None
    before = entry.slots if entry else []
    entry = entry or SheetEntry(sheet=sheet, day=day)
    entry.slots, entry.meta, entry.remarks, entry.updated_by = slots, details, remarks, user
    entry.save()
    pending = sum(1 for m in details if m and m.get("review") == "pending")
    audit.log(user, "entry.save", sheet, flagged=correction, day=str(day), before=before, after=slots, **({"pending": pending} if pending else {}))
    return entry


@transaction.atomic
def save_kpi(user, sheet, week_start, data):
    reason = kpi_block(user, sheet, week_start)
    if reason:
        raise Locked(reason)
    kpi, _ = KpiEntry.objects.select_for_update().get_or_create(sheet=sheet, week_start=week_start)
    for k, v in data.items():
        setattr(kpi, k, v)
    kpi.updated_by, kpi.source = user, KpiEntry.Source.TYPED
    kpi.save()
    audit.log(user, "kpi.save", sheet, week=str(week_start), **{k: str(v) for k, v in data.items()})
    return kpi


# ---------- numbers ----------

def renewal_revenue(cfg):
    """{(sheet id, week start): amount} from renewals won (SRS FR-RN4), while the renewal tracker is switched on."""
    from core.features import is_on
    if not is_on("renewals"):
        return {}
    from renewals.services import revenue_by_sheet_week   # renewals builds on team, so it's imported here, not at the top
    return revenue_by_sheet_week(cfg)


def kpi_rows(sheet, renewals=None):
    """A sheet's weekly results as plain rows for calc. renewals (from renewal_revenue) is added to each week's revenue,
    with a row of its own for a week that has no results entered."""
    rows = [{"week_start": k.week_start, "leads": k.leads, "opps": k.opps, "clients": k.clients, "revenue": float(k.revenue), "counts_in": k.counts_in}
            for k in sheet.kpis.all()]
    if renewals:
        mine = {ws: v for (sheet_id, ws), v in renewals.items() if sheet_id == sheet.id}
        for r in rows:
            if r["week_start"] in mine:
                r["revenue"] = calc.r2(r["revenue"] + mine.pop(r["week_start"]))
        rows += [{"week_start": ws, "leads": 0, "opps": 0, "clients": 0, "revenue": v, "counts_in": ""} for ws, v in sorted(mine.items())]
    return rows


def _snapshot(sheets_qs, renewals=True, ledger=True):
    """Each sheet's days and weekly results. Hours and points come from the score ledger (SRS v0.5 FR-S1), so they stay as they were
    scored. renewals=False, ledger=False: only the results people entered (for "missing results")."""
    from scoring import services as scoring   # scoring builds on this module, so it's imported here
    st = TeamSettings.load()
    cfg = cfg_of(st)
    sheets = list(sheets_qs.select_related("owner", "role").prefetch_related("kpis"))
    extra = renewal_revenue(cfg) if renewals else None
    days, pts = scoring.days_for([s.id for s in sheets]) if ledger else ({}, {})
    data = [(s, days.get(s.id, []), kpi_rows(s, extra)) for s in sheets]
    return st, scoring.read_cfg(cfg), pts, data


def _sheet_meta(s):
    return {"id": s.id, "name": s.name, "person": s.person or (s.owner.name if s.owner else ""), "role": s.role.name if s.role else None,
            "owner_id": s.owner_id}


def work_sheets():
    return Sheet.objects.filter(kind=Sheet.Kind.WORK, archived=False)


def dashboard_rows(on=None, finished_month=False):
    """finished_month: `on` is the last day of a past month, so the week shown is that month's last whole week."""
    from scoring.services import Book
    st, cfg, pts, data = _snapshot(work_sheets())
    on = on or today(st)
    week_on = calc.last_full_week_end(on, cfg) if finished_month else None
    book = Book()                          # the month's targets are the ones of its configuration version (SRS v0.5 §7)
    return on, [{**_sheet_meta(s), **calc.dashboard(book.targets(s, on), e, k, cfg, pts, on, week_on)} for s, e, k in data]


def performance_rows(year, on=None):
    from scoring.services import Book
    st, cfg, pts, data = _snapshot(work_sheets())
    on = on or today(st)
    book = Book()
    return on, [{**_sheet_meta(s), **calc.performance(s.targets, e, k, cfg, pts, s.role.weights if s.role else None, year, on, monthly=book.monthly(s))}
                for s, e, k in data]


def setup_warnings():
    roles = [{"name": r.name, "weights": r.weights, "tasks": list(r.tasks.values_list("id", flat=True))} for r in JobRole.objects.prefetch_related("tasks")]
    sheets = [{"name": s.name, "kind": s.kind, "archived": s.archived, "role": s.role.name if s.role else None, "targets": s.targets}
              for s in Sheet.objects.select_related("role")]
    return calc.warnings(roles, sheets)


def sheet_summary(sheet, frm, to, st=None):
    """Totals for a sheet's view of [frm, to], all calculated here so every screen and export agrees.
    Each week shows its full Saturday-to-Friday total, even when it runs into the next or previous month."""
    from scoring import services as scoring
    st = st or TeamSettings.load()
    cfg = cfg_of(st)
    first, last = calc.week_start_of(frm, cfg), calc.week_start_of(to, cfg) + timedelta(days=6)
    book = scoring.Book()
    if sheet.kind == Sheet.Kind.WORK:      # what was scored (SRS v0.5 FR-S1)
        by, pts = scoring.days_for([sheet.id], first, last)
        days, cfg = by.get(sheet.id, []), scoring.read_cfg(cfg)
    else:                                  # a plan isn't scored: it shows what it would earn today
        pts = {t.id: float(t.points) for t in Task.objects.all()}
        days = [calc.Day(e.day, e.counted_slots()) for e in sheet.entries.filter(day__range=(first, last))]
    weeks, ws = [], first
    while ws <= to:
        we = ws + timedelta(days=6)
        h, p = calc.totals(days, ws, we, cfg, pts)
        no, year = calc.week_no(ws, cfg)
        target = book.targets(sheet, ws + timedelta(days=3))["hours"] if sheet.kind == Sheet.Kind.WORK else float(sheet.target_hours)
        weeks.append({"start": ws, "end": we, "no": no, "year": year, "hours": h, "points": p, "target_hours": target, "status": calc.final_of(h, target)})
        ws += timedelta(days=7)
    h, p = calc.totals(days, frm, to, cfg, pts)
    role_tasks = sheet.role.tasks.filter(active=True) if sheet.role else Task.objects.none()
    choices = list(role_tasks.filter(scoring_mode=Task.ScoringMode.TIME).values_list("id", flat=True))
    event_tasks = role_tasks.filter(scoring_mode=Task.ScoringMode.EVENT)
    if kpi_derived(st):                    # a work order counts when a supervisor verifies the win in the pipeline (FR-K2)
        event_tasks = event_tasks.exclude(counts_as_win=True)
    events = [{"id": t.id, "name": t.name, "points": float(t.points)} for t in event_tasks]
    return {"weeks": weeks, "totals": {"hours": h, "points": p}, "choices": choices, "event_choices": events,
            "week_start_dow": st.week_start_dow, "weekend_days": st.weekend_days, "count_weekend": st.count_weekend,
            "lock_days": st.lock_days, "timezone": st.timezone, "seconds_to_lock": calc.seconds_to_midnight(st.timezone, now())}


def delete_team_data():
    """Remove every sheet with its days and weekly KPIs. Accounts, profiles, tasks, job roles, team rules,
    personal trackers and the activity log stay. Returns what was removed."""
    from scoring import services as scoring
    counts = {"sheets": Sheet.objects.count(), "days": SheetEntry.objects.count(), "kpi_weeks": KpiEntry.objects.count()}
    with scoring.paused():                # one configuration version for the whole clear-out, not one per sheet
        Sheet.objects.all().delete()      # days, KPIs and ledger rows go with their sheet
    scoring.sync_config()
    return counts


def wins_between(a, b, details=True):
    """Wins logged from day a to day b: a task that counts as a win (e.g. Client Work Order Receiving) in someone's work log.
    Newest first; one win per task per day, however many hour slots it took. Used by the office TV and the morning huddle.
    Returns None when no task counts as a win yet."""
    from accounts.services import photo_of
    names = dict(Task.objects.filter(counts_as_win=True).values_list("id", "name"))
    if not names:
        return None
    match = Q()
    for task_id in names:
        match |= Q(slots__contains=[task_id])
    entries = (SheetEntry.objects.filter(match, day__range=(a, b), sheet__kind=Sheet.Kind.WORK, sheet__archived=False)
               .select_related("sheet__owner__profile").order_by("-day", "-updated_at"))
    out = []
    for e in entries:
        s = e.sheet
        for task_id in dict.fromkeys(x for x in e.counted_slots() if x in names):
            out.append({"id": f"{e.pk}-{task_id}", "day": e.day, "what": names[task_id], "owner_id": s.owner_id,
                        "person": s.person or (s.owner.name if s.owner else s.name), "photo": photo_of(s.owner),
                        "details": (e.remarks.strip()[:160] or None) if details else None})
    from scoring.models import EventLog           # verified events that count as wins (SRS v0.5 D2)
    events = (EventLog.objects.filter(status=EventLog.Status.VERIFIED, activity_id__in=names, day__range=(a, b), sheet__kind=Sheet.Kind.WORK, sheet__archived=False)
              .select_related("sheet__owner__profile", "record"))
    for ev in events:
        s = ev.sheet
        out.append({"id": f"event-{ev.pk}", "day": ev.day, "what": names[ev.activity_id], "owner_id": s.owner_id,
                    "person": s.person or (s.owner.name if s.owner else s.name), "photo": photo_of(s.owner),
                    "details": ((ev.record.company if ev.record else ev.note or ev.evidence)[:160] or None) if details else None})
    out.sort(key=lambda w: w["day"], reverse=True)
    return out


def missing_results(on, owner_id=None):
    """Completed weeks this year with no results entered (no row, or all four numbers zero), per work sheet.
    Counts from each sheet's start date. owner_id limits the list to one person's sheets."""
    _, cfg, _, data = _snapshot(work_sheets(), renewals=False, ledger=False)
    year_start = date(on.year, 1, 1)
    gaps = []
    for s, _, kpis in data:
        if owner_id is not None and s.owner_id != owner_id:
            continue
        have = {k["week_start"]: k for k in kpis}
        ws = calc.week_start_of(max(s.start_date or year_start, year_start), cfg)
        weeks = []
        while ws + timedelta(days=6) < on:
            k = have.get(ws)
            if k is None or not any(k[f] for f in ("leads", "opps", "clients", "revenue")):
                weeks.append(ws.isoformat())
            ws += timedelta(days=7)
        if weeks:
            gaps.append({"sheet": s.id, "person": s.person or s.name, "weeks": weeks})
    return gaps


def link_unowned_sheets(user):
    """Give a person the sheets that carry their name and have nobody filling them in yet (work log and plan).
    Called when someone is approved or signs in, so admins don't have to link imported sheets by hand."""
    if not (user.is_approved and user.role != User.Role.VIEWER and user.name.strip()):
        return []
    sheets = list(Sheet.objects.filter(owner__isnull=True, archived=False, person__iexact=user.name.strip()))
    for s in sheets:
        s.owner = user
        s.save(update_fields=["owner", "updated_at"])
        audit.log(user, "sheet.linked", s, how="name matches")
    return [s.name for s in sheets]


def entry_numbers(entry, pts):
    return {"hours": calc.day_hours(entry.counted_slots()), "points": calc.day_points(entry.counted_slots(), pts)}


def parse_day(value, default=None):
    try:
        return date.fromisoformat(value) if value else default
    except ValueError:
        raise Locked(f"{value} isn't a date like 2026-10-29.")


def month_day(value, t):
    """The day a month is seen from: its last day for a past month, today for this month (?month=2026-10)."""
    try:
        ms = date.fromisoformat(f"{value}-01")
    except ValueError:
        raise Locked(f"{value} isn't a month like 2026-10.")
    if ms > t:
        raise Locked("That month hasn't started yet.")
    return min(calc.month_end(ms), t)
