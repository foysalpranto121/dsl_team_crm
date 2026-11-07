"""Team sheet rules: who may change what (including the midnight lock), saving entries, and building the numbers."""
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from core import audit

from . import calc
from .models import SLOTS, JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings


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

def entry_block(user, sheet, day, st=None):
    """None if the person may change this sheet on this day, otherwise the reason they can't."""
    if user.is_team_admin:
        return None
    if not (user.is_approved and user.role == User.Role.MEMBER):
        return "Viewers can look at sheets but not change them."
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
            return "You can only fill in today. Use your plan sheet to plan ahead."
    return None


def kpi_block(user, sheet, week_start, st=None):
    st = st or TeamSettings.load()
    if calc.dow(week_start) != st.week_start_dow:
        return "A week must start on the team's first day of the week."
    if sheet.kind != Sheet.Kind.WORK:
        return "Weekly results go on work-log sheets, not plans."
    if user.is_team_admin:
        return None
    if not (user.is_approved and user.role == User.Role.MEMBER):
        return "Viewers can look at results but not change them."
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
    if not user.is_team_admin:
        allowed = set(sheet.role.tasks.filter(active=True).values_list("id", flat=True)) if sheet.role else set()
        prev = (previous or []) + [None] * SLOTS
        for i, s in enumerate(slots):
            if s is not None and s != prev[i] and s not in allowed:
                raise Locked(f'"{known[s].name}" isn\'t one of your job role\'s tasks.')
    while slots and slots[-1] is None:
        slots.pop()
    return slots


@transaction.atomic
def save_entry(user, sheet, day, slots, remarks):
    st = TeamSettings.load()
    reason = entry_block(user, sheet, day, st)
    if reason:
        raise Locked(reason)
    entry = SheetEntry.objects.select_for_update().filter(sheet=sheet, day=day).first()
    slots = clean_slots(user, sheet, slots, entry.slots if entry else None)
    remarks = (remarks or "").strip()[:2000]
    correction = user.is_team_admin and st.lock_days and day < today(st)   # an admin changing a locked day
    if not calc.filled(slots) and not remarks:
        if entry:
            entry.delete()
            audit.log(user, "entry.clear", sheet, flagged=correction, day=str(day))
        return None
    before = entry.slots if entry else []
    entry = entry or SheetEntry(sheet=sheet, day=day)
    entry.slots, entry.remarks, entry.updated_by = slots, remarks, user
    entry.save()
    audit.log(user, "entry.save", sheet, flagged=correction, day=str(day), before=before, after=slots)
    return entry


@transaction.atomic
def save_kpi(user, sheet, week_start, data):
    reason = kpi_block(user, sheet, week_start)
    if reason:
        raise Locked(reason)
    kpi, _ = KpiEntry.objects.select_for_update().get_or_create(sheet=sheet, week_start=week_start)
    for k, v in data.items():
        setattr(kpi, k, v)
    kpi.updated_by = user
    kpi.save()
    audit.log(user, "kpi.save", sheet, week=str(week_start), **{k: str(v) for k, v in data.items()})
    return kpi


# ---------- numbers ----------

def _snapshot(sheets_qs):
    st = TeamSettings.load()
    pts = {t.id: float(t.points) for t in Task.objects.all()}
    sheets = list(sheets_qs.select_related("owner", "role").prefetch_related("entries", "kpis"))
    data = []
    for s in sheets:
        entries = [calc.Day(e.day, e.slots) for e in s.entries.all()]
        kpis = [{"week_start": k.week_start, "leads": k.leads, "opps": k.opps, "clients": k.clients, "revenue": float(k.revenue), "counts_in": k.counts_in} for k in s.kpis.all()]
        data.append((s, entries, kpis))
    return st, cfg_of(st), pts, data


def _sheet_meta(s):
    return {"id": s.id, "name": s.name, "person": s.person or (s.owner.name if s.owner else ""), "role": s.role.name if s.role else None,
            "owner_id": s.owner_id}


def work_sheets():
    return Sheet.objects.filter(kind=Sheet.Kind.WORK, archived=False)


def dashboard_rows(on=None, finished_month=False):
    """finished_month: `on` is the last day of a past month, so the week shown is that month's last whole week."""
    st, cfg, pts, data = _snapshot(work_sheets())
    on = on or today(st)
    week_on = calc.last_full_week_end(on, cfg) if finished_month else None
    return on, [{**_sheet_meta(s), **calc.dashboard(s.targets, e, k, cfg, pts, on, week_on)} for s, e, k in data]


def performance_rows(year, on=None):
    st, cfg, pts, data = _snapshot(work_sheets())
    on = on or today(st)
    return on, [{**_sheet_meta(s), **calc.performance(s.targets, e, k, cfg, pts, s.role.weights if s.role else None, year, on)}
                for s, e, k in data]


def setup_warnings():
    roles = [{"name": r.name, "weights": r.weights, "tasks": list(r.tasks.values_list("id", flat=True))} for r in JobRole.objects.prefetch_related("tasks")]
    sheets = [{"name": s.name, "kind": s.kind, "archived": s.archived, "role": s.role.name if s.role else None, "targets": s.targets}
              for s in Sheet.objects.select_related("role")]
    return calc.warnings(roles, sheets)


def sheet_summary(sheet, frm, to, st=None):
    """Totals for a sheet's view of [frm, to], all calculated here so every screen and export agrees.
    Each week shows its full Saturday-to-Friday total, even when it runs into the next or previous month."""
    st = st or TeamSettings.load()
    cfg = cfg_of(st)
    pts = {t.id: float(t.points) for t in Task.objects.all()}
    first, last = calc.week_start_of(frm, cfg), calc.week_start_of(to, cfg) + timedelta(days=6)
    days = [calc.Day(e.day, e.slots) for e in sheet.entries.filter(day__range=(first, last))]
    weeks, ws = [], first
    while ws <= to:
        we = ws + timedelta(days=6)
        h, p = calc.totals(days, ws, we, cfg, pts)
        no, year = calc.week_no(ws, cfg)
        weeks.append({"start": ws, "end": we, "no": no, "year": year, "hours": h, "points": p,
                      "target_hours": float(sheet.target_hours), "status": calc.final_of(h, float(sheet.target_hours))})
        ws += timedelta(days=7)
    h, p = calc.totals(days, frm, to, cfg, pts)
    choices = list(sheet.role.tasks.filter(active=True).values_list("id", flat=True)) if sheet.role else []
    return {"weeks": weeks, "totals": {"hours": h, "points": p}, "choices": choices,
            "week_start_dow": st.week_start_dow, "weekend_days": st.weekend_days, "count_weekend": st.count_weekend,
            "lock_days": st.lock_days, "timezone": st.timezone, "seconds_to_lock": calc.seconds_to_midnight(st.timezone, now())}


def delete_team_data():
    """Remove every sheet with its days and weekly KPIs. Accounts, profiles, tasks, job roles, team rules,
    personal trackers and the activity log stay. Returns what was removed."""
    counts = {"sheets": Sheet.objects.count(), "days": SheetEntry.objects.count(), "kpi_weeks": KpiEntry.objects.count()}
    Sheet.objects.all().delete()          # days and KPIs go with their sheet
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
        for task_id in dict.fromkeys(x for x in e.slots if x in names):
            out.append({"id": f"{e.pk}-{task_id}", "day": e.day, "what": names[task_id], "owner_id": s.owner_id,
                        "person": s.person or (s.owner.name if s.owner else s.name), "photo": photo_of(s.owner),
                        "details": (e.remarks.strip()[:160] or None) if details else None})
    return out


def missing_results(on, owner_id=None):
    """Completed weeks this year with no results entered (no row, or all four numbers zero), per work sheet.
    Counts from each sheet's start date. owner_id limits the list to one person's sheets."""
    _, cfg, _, data = _snapshot(work_sheets())
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
    return {"hours": calc.day_hours(entry.slots), "points": calc.day_points(entry.slots, pts)}


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
