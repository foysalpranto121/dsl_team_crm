"""What a sales-floor TV shows (SRS §14.5, FR-TV1–TV3). Every number comes from team.services, the same code as the
dashboard, so the TV and the dashboard always agree. Fairness (FR-MO9, NFR-11): only team totals and the top few are
shown — never a list of who is behind or who hasn't logged."""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from team import calc
from team import services as team
from team.models import Sheet, SheetEntry, Task, TeamSettings

from .models import DisplayScreen

WIN_DAYS = 30   # wins from the last 30 days
MAX_WINS = 8


def photo_of(user):
    if user is None:
        return None
    profile = getattr(user, "profile", None)   # a missing profile raises an AttributeError subclass, so getattr's default applies
    if profile is not None and profile.photo:
        return profile.photo.url
    return user.google_picture or None


def _total(rows, key):
    return calc.r2(sum(r[key] for r in rows))


def progress(rows, cfg, on, show_values):
    """Team totals for today, this week and this month, with the dashboard's pace rules."""
    ws = calc.week_start_of(on, cfg)
    ms, me = calc.month_start(on), calc.month_end(on)
    week_wd, month_wd = calc.working_days(ws, ws + timedelta(days=6), cfg), calc.working_days(ms, me, cfg)
    workday = calc.working_days(on, on, cfg) == 1
    week_hours, week_target = _total(rows, "week_hours"), _total(rows, "week_target")
    month_points, month_target = _total(rows, "month_points"), _total(rows, "month_target")

    def kpi(key, label, money=False):
        value = calc.r2(sum(r["kpi_month"][key] for r in rows))
        target = calc.r2(sum(r["kpi_targets"][key] for r in rows))
        hidden = money and not show_values   # the revenue amount only when the screen may show values; the % always
        return {"key": key, "label": label, "value": None if hidden else value, "target": None if hidden else target,
                "pct": value / target if target > 0 else None}

    return {
        "people": len(rows),
        "logged_today": sum(1 for r in rows if r["today_hours"] > 0),
        "today": {"value": _total(rows, "today_hours"), "workday": workday,
                  "target": calc.r2(week_target / week_wd) if workday and week_wd else 0},
        "week": {"value": week_hours, "target": week_target,
                 "status": calc.pace_of(week_hours, week_target, calc.working_days(ws, on, cfg), week_wd)},
        "month": {"value": month_points, "target": month_target,
                  "status": calc.pace_of(month_points, month_target, calc.working_days(ms, on, cfg), month_wd)},
        "kpis": [kpi("leads", "Qualified leads"), kpi("opps", "Opportunities"), kpi("clients", "Clients"),
                 kpi("revenue", "Revenue", money=True)],
    }


def wins(on, show_values):
    """Days in the last 30 where someone logged a task that counts as a win (e.g. Client Work Order Receiving),
    newest first. One win per task per day, however many hour slots it took."""
    names = dict(Task.objects.filter(counts_as_win=True).values_list("id", "name"))
    if not names:
        return {"configured": False, "items": []}
    match = Q()
    for task_id in names:
        match |= Q(slots__contains=[task_id])
    entries = (SheetEntry.objects
               .filter(match, day__range=(on - timedelta(days=WIN_DAYS - 1), on), sheet__kind=Sheet.Kind.WORK, sheet__archived=False)
               .select_related("sheet__owner__profile").order_by("-day", "-updated_at")[:MAX_WINS * 2])
    items = []
    for e in entries:
        s = e.sheet
        for task_id in dict.fromkeys(x for x in e.slots if x in names):
            items.append({
                "id": f"{e.pk}-{task_id}", "day": e.day, "today": e.day == on, "what": names[task_id],
                "person": s.person or (s.owner.name if s.owner else s.name), "photo": photo_of(s.owner),
                "details": (e.remarks.strip()[:160] or None) if show_values else None,
            })
    return {"configured": True, "items": items[:MAX_WINS]}


def leaders(rows, perf, on, mode, count, people):
    """Top performers (this month's composite score, then points) or top improvers (this month's pace against last
    month's result, so a half-finished month is compared fairly). Only the top `count`; people with no activity never appear."""
    if mode == DisplayScreen.Leaders.OFF:
        return {"mode": mode, "rows": []}

    def card(r, **extra):
        return {"id": r["id"], "person": r["person"] or r["name"], "role": r["role"], "photo": photo_of(people.get(r["owner_id"])),
                "points": r["month_points"], **extra}

    if mode == DisplayScreen.Leaders.TOP:
        score = {r["id"]: r["months"][on.month - 1].get("score") for r in perf}
        active = [r for r in rows if r["month_points"] > 0 or (score.get(r["id"]) or 0) > 0]
        active.sort(key=lambda r: (score.get(r["id"]) if score.get(r["id"]) is not None else -1, r["month_points"]), reverse=True)
        return {"mode": mode, "rows": [card(r, score=score.get(r["id"])) for r in active[:count]]}

    better = []
    for r in rows:
        now, last = r["month_status"], r["last_month_status"]
        if now["pct"] is None or last["pct"] is None or now["key"] == "early":
            continue
        pace = r["month_points"] / now["expected"] if now.get("expected") else now["pct"]
        change = pace - last["pct"]
        if change > 0:
            better.append((change, r))
    better.sort(key=lambda x: x[0], reverse=True)
    return {"mode": mode, "rows": [card(r, change=round(c, 4)) for c, r in better[:count]]}


def feed(screen):
    st = TeamSettings.load()
    cfg = team.cfg_of(st)
    on, rows = team.dashboard_rows()
    show_leaders = "leaders" in screen.panels and screen.leaders != DisplayScreen.Leaders.OFF
    perf = team.performance_rows(on.year, on)[1] if show_leaders and screen.leaders == DisplayScreen.Leaders.TOP else []
    people = {u.pk: u for u in User.objects.filter(pk__in={r["owner_id"] for r in rows if r["owner_id"]}).select_related("profile")}
    want_wins = "wins" in screen.panels or screen.celebrate
    return {
        "screen": {"name": screen.name, "panels": screen.panels, "rotate_seconds": screen.rotate_seconds, "leaders": screen.leaders,
                   "show_values": screen.show_values, "celebrate": screen.celebrate, "sound": screen.sound},
        "team": {"name": st.name, "timezone": st.timezone, "today": on, "week_no": calc.week_no(calc.week_start_of(on, cfg), cfg)[0]},
        "progress": progress(rows, cfg, on, screen.show_values),
        "wins": wins(on, screen.show_values) if want_wins else {"configured": True, "items": []},
        "leaders": leaders(rows, perf, on, screen.leaders if show_leaders else DisplayScreen.Leaders.OFF, screen.leaders_count, people),
        "generated_at": timezone.now(),
    }
