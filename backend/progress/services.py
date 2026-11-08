"""The Weekly Review, My Progress and the AI Coach's reading of the numbers (SRS v0.5 §5.9, §5.11, §5.12).

Rules and arithmetic only, on the person's own data: every line says what it's based on and links to it (FR-AC8). A member sees their own; leaders
see their team (D9). None of it changes a score, an approval or a target. With the coach switched off, the rings, gaps and review still work.
"""
from collections import Counter, defaultdict
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from accounts.models import User
from core import audit
from frameworks.models import OverloadFlag, StepInstance
from playbook import services as playbook
from scoring import services as scoring
from scoring.models import EventLog, ScoreLedger
from team import calc, planning
from team import services as team
from team.models import KpiEntry, Sheet, SheetEntry, TeamSettings, WeekPlan
from tracker import kpis, pipeline
from tracker.models import ClientLogEntry, KpiType, PipelineStage, Prospect, StageEvent

from . import calc as pc
from .models import WeeklyReview

K = PipelineStage.Kind
METRICS = {
    "hours": {"label": "Output hours", "one": "output hour", "many": "output hours", "means": "Hours that count: logged, and approved where approval is needed.", "period": "week"},
    "points": {"label": "Points", "one": "point", "many": "points", "means": "What your hours and verified events earned this month.", "period": "month"},
    "leads": {"label": "Qualified leads", "one": "qualified lead", "many": "qualified leads", "means": "Records that first reached Qualified Lead this month.", "period": "month"},
    "opps": {"label": "Opportunities", "one": "opportunity", "many": "opportunities", "means": "Records that first reached the opportunity stage this month.", "period": "month"},
    "clients": {"label": "Clients", "one": "client", "many": "clients", "means": "Wins whose work order a supervisor verified this month.", "period": "month"},
    "revenue": {"label": "Revenue", "one": "taka", "many": "taka", "means": "The value of this month's verified wins.", "period": "month"},
}
PACE_LABEL = {"met": "On target", "onpace": "On target", "near": "Near", "behind": "Below", "below": "Below", "early": "Starting", "none": "No target"}


class ProgressError(Exception):
    """The request doesn't make sense as asked (HTTP 400)."""


class NotAllowed(Exception):
    """This person may not see or do this (HTTP 403)."""


def _sees_team(user):
    return user.can_approve or user.role == User.Role.VIEWER


def subject(user, work_id=None):
    """Whose numbers: your own, or (D9) a team member's for leaders."""
    if work_id:
        work = Sheet.objects.filter(pk=work_id, kind=Sheet.Kind.WORK).select_related("role", "owner").first()
        if work is None:
            raise ProgressError("That daily log doesn't exist.")
        if work.owner_id != user.pk and not _sees_team(user):
            raise NotAllowed("You see your own progress; leaders see their team's.")
        return work
    work = planning.work_of_user(user)
    if work is None:
        raise ProgressError("You don't have a daily log yet.")
    return work


def _coach_on(st):
    """FR-AC8: the team's off switch. Everything the coach adds goes; nothing else changes."""
    return playbook.config(st)["sources"]["suggested"]


def _week(st, value):
    cfg = team.cfg_of(st)
    day = team.parse_day(value, team.today(st))
    ws = calc.week_start_of(day, cfg)
    return ws, ws + timedelta(days=6), cfg


def _short(d):
    return f"{d.day} {d:%b}" if d else ""


# ---------- FR-CL2: the week's status, compiled from the Client Log ----------

def week_status(owner_id, ws, stages=None):
    stages = stages or pipeline.stage_map()
    end = ws + timedelta(days=6)
    by = defaultdict(list)
    for e in ClientLogEntry.objects.filter(record__owner_id=owner_id, day__range=(ws, end)).select_related("record").order_by("day", "id"):
        by[e.record_id].append(e)
    records = {p.id: p for p in Prospect.objects.filter(pk__in=by)}
    out = []
    for rid, rows in by.items():
        p, st = records[rid], stages.get(records[rid].stage)
        contacts = [e for e in rows if e.type != ClientLogEntry.Type.STAGE]
        moved = [e.note for e in rows if e.type == ClientLogEntry.Type.STAGE]
        last = contacts[-1] if contacts else None
        bits = []
        if contacts:
            bits.append(pc.plural(len(contacts), "contact"))
        if last and last.outcome:
            bits.append(f"Last outcome: {last.outcome}")
        if moved:
            bits.append(moved[-1])
        out.append({"record": rid, "company": p.company, "stage": st.name if st else p.stage, "stage_kind": st.kind if st else K.OPEN, "summary": " · ".join(bits) or "No contact logged.",
                    "next_action": p.next_action, "next_date": p.next_follow_up, "verified": bool(p.won_verified_at), "entries": len(rows)})
    return sorted(out, key=lambda r: r["company"].lower())


# ---------- FR-MO7: the personal recap ----------

def recap(work, ws, st=None):
    st = st or TeamSettings.load()
    cfg, end, prev = team.cfg_of(st), ws + timedelta(days=6), ws - timedelta(days=7)
    scored = scoring.day_totals([work.id], prev, end)
    this = {d: n for (_, d), n in scored.items() if d >= ws}
    before = {d: n for (_, d), n in scored.items() if d < ws}
    hours, points = sum(n["hours"] for n in this.values()), calc.r2(sum(n["points"] for n in this.values()))
    h0, p0 = sum(n["hours"] for n in before.values()), calc.r2(sum(n["points"] for n in before.values()))
    best = max(this.items(), key=lambda x: (x[1]["points"], x[1]["hours"]), default=None)
    k = KpiEntry.objects.filter(sheet=work, week_start=ws).first()
    k0 = KpiEntry.objects.filter(sheet=work, week_start=prev).first()
    now = {m: float(getattr(k, m) or 0) if k else 0 for m in ("leads", "opps", "clients", "revenue")}
    was = {m: float(getattr(k0, m) or 0) if k0 else 0 for m in now}
    wins = [w for w in (team.wins_between(ws, end, details=True) or []) if w["owner_id"] == work.owner_id]
    improved = []
    if hours > h0:
        improved.append(f"{pc.plural(hours - h0, 'more output hour', 'more output hours')} than the week before")
    if points > p0:
        improved.append(f"{pc.plural(calc.r2(points - p0), 'more point', 'more points')} than the week before")
    for m, one, many in (("leads", "more qualified lead", "more qualified leads"), ("opps", "more opportunity", "more opportunities"), ("clients", "more client", "more clients")):
        if now[m] > was[m]:
            improved.append(f"{pc.plural(int(now[m] - was[m]), one, many)} than the week before")
    approved, done = 0, 0.0
    plans = planning.approved_plans(work, ws, end, cfg)
    entries = {e.day: e for e in work.entries.filter(day__range=(ws, end))}
    for d, row in plans.items():
        _, c, n = planning.adherence(row, entries.get(d))
        approved, done = approved + n, done + c
    return {"week_start": ws, "week_end": end, "hours": hours, "points": points, "kpis": now, "hours_before": h0, "points_before": p0,
            "wins": [{"what": w["what"], "details": w["details"], "day": w["day"]} for w in wins], "best_day": {"day": best[0], "hours": best[1]["hours"], "points": best[1]["points"]} if best and best[1]["points"] else None,
            "improved": improved, "adherence": round(done / approved, 2) if approved else None, "approved_hours": approved}


# ---------- FR-WR1: the Weekly Review ----------

def _gaps_short(work, st):
    """Up to three candidates for "one focus", from the biggest gaps."""
    _, row = _rows(work, st)
    out = []
    left = max(0.0, row["week_target"] - row["week_hours"])
    if left:
        out.append(f"Log {left:g} more output hours")
    for m, one, many in (("leads", "qualified lead", "qualified leads"), ("opps", "opportunity", "opportunities"), ("clients", "client", "clients")):
        gap = int(row["kpi_targets"][m] - row["kpi_month"][m])
        if gap > 0:
            out.append(f"Get {pc.plural(gap, one, many)} this month")
    rec = Prospect.objects.filter(owner_id=work.owner_id, next_follow_up__isnull=False, stage__in=[k for k, s in pipeline.stage_map().items() if s.kind == K.OPEN]).order_by("-value", "next_follow_up").first()
    if rec:
        out.append(f"Move {rec.company} forward")
    return out[:3]


def _next_plan(work, ws, st):
    nxt = ws + timedelta(days=7)
    plan_sheet = planning.plan_sheet_for(work)
    p = WeekPlan.objects.filter(sheet=plan_sheet, week_start=nxt).first() if plan_sheet else None
    planned = sum(calc.day_hours(e.slots) for e in plan_sheet.entries.filter(day__range=(nxt, nxt + timedelta(days=6)))) if plan_sheet else 0
    states = [x for v in (p.slot_states or {}).values() for x in v if x] if p else []
    sent = sum(1 for x in states if x in (planning.SUBMITTED, planning.APPROVED))
    return {"week_start": nxt, "status": p.status if p else None, "status_label": p.get_status_display() if p else "Not planned", "planned_hours": planned, "sent_hours": sent,
            "unsent_hours": max(0, planned - sent), "done": sent > 0, "target_hours": float(work.target_hours)}


def review(user, work_id=None, week=None):
    work = subject(user, work_id)
    st = TeamSettings.load()
    ws, end, _ = _week(st, week)
    t = team.today(st)
    r = WeeklyReview.objects.filter(owner_id=work.owner_id, week_start=ws).first()
    k = KpiEntry.objects.filter(sheet=work, week_start=ws).first()
    derived = team.kpi_derived(st, ws)
    if derived and work.owner_id:
        kpis.refresh(work.owner_id, st)
        k = KpiEntry.objects.filter(sheet=work, week_start=ws).first()
    numbers = kpis.current(k) if k else kpis.zero()
    confirmed = bool(k and k.confirmed_at and {m: float(v) for m, v in (k.confirmed or {}).items()} == {m: float(v) for m, v in numbers.items()})
    waiting = kpis.evidence(work.owner_id, ws, st)["waiting"] if work.owner_id else []
    deals = week_status(work.owner_id, ws) if work.owner_id else []
    entered = not derived and bool(k and any(float(v) for v in numbers.values()))
    next_plan = _next_plan(work, ws, st)
    steps = {"kpi": confirmed or entered, "deals": bool(r and r.deals_confirmed_at) or not deals, "focus": bool(r and r.focus), "plan": next_plan["done"]}
    return {"week_start": ws, "week_end": end, "week_no": calc.week_no(ws, team.cfg_of(st))[0], "today": t, "current": ws <= t <= end, "person": planning.person_of(work), "work": work.id, "mine": work.owner_id == user.pk,
            "kpi": {"numbers": numbers, "derived": derived, "confirmed": confirmed, "entered": entered, "waiting": waiting, "currency": st.currency},
            "deals": deals, "deals_confirmed_at": r.deals_confirmed_at if r else None, "recap": recap(work, ws, st), "focus": r.focus if r else "", "focus_options": _gaps_short(work, st),
            "last_focus": (WeeklyReview.objects.filter(owner_id=work.owner_id, week_start=ws - timedelta(days=7)).values_list("focus", flat=True).first() or ""),
            "next_plan": next_plan, "steps": steps, "submitted_at": r.submitted_at if r else None, "ready": all(steps.values())}


@transaction.atomic
def act(user, action, week=None, focus=""):
    """The member's confirmations (FR-WR1, FR-K3, FR-CL2)."""
    work = subject(user)
    st = TeamSettings.load()
    ws, _, _ = _week(st, week)
    if ws > team.today(st):
        raise ProgressError("That week hasn't started yet.")
    r, _ = WeeklyReview.objects.get_or_create(owner=user, week_start=ws)
    if action == "confirm_kpi":
        try:
            kpis.confirm(user, work, ws)
        except kpis.KpiError as e:
            raise ProgressError(str(e))
    elif action == "confirm_deals":
        r.deals_confirmed_at = timezone.now()
        r.save(update_fields=["deals_confirmed_at", "updated_at"])
    elif action == "focus":
        focus = " ".join((focus or "").split())
        if len(focus) < 3:
            raise ProgressError("Pick one focus for next week.")
        r.focus = focus[:300]
        r.save(update_fields=["focus", "updated_at"])
    elif action == "submit_plan":
        try:
            planning.act(user, work, ws + timedelta(days=7), "submit")
        except (planning.PlanError, planning.NotAllowed) as e:
            raise ProgressError(str(e))
    elif action == "submit":
        state = review(user, week=str(ws))
        missing = [label for key, label in (("kpi", "the KPI numbers"), ("deals", "the deal statuses"), ("focus", "one focus"), ("plan", "next week's plan")) if not state["steps"][key]]
        if missing:
            raise ProgressError(f"Still to do: {', '.join(missing)}.")
        r.recap = {k: (str(v) if hasattr(v, "isoformat") else v) for k, v in state["recap"].items() if k in ("hours", "points", "improved", "adherence", "kpis")}
        r.submitted_at = timezone.now()
        r.save(update_fields=["recap", "submitted_at", "updated_at"])
        audit.log(user, "review.submit", work, week=str(ws), focus=r.focus)
    else:
        raise ProgressError("Unknown action.")
    return review(user, week=str(ws))


# ---------- FR-WR2, FR-AC5: the team's review, from the same data ----------

def team_review(user, week=None):
    if not _sees_team(user):
        raise NotAllowed("Only supervisors, management and admins see the team's review.")
    st = TeamSettings.load()
    ws, end, cfg = _week(st, week)
    works = list(team.work_sheets().select_related("owner", "role"))
    scored = defaultdict(lambda: {"hours": 0, "points": 0.0})
    for (sheet_id, _), n in scoring.day_totals([w.id for w in works], ws, end).items():
        scored[sheet_id]["hours"] += n["hours"]
        scored[sheet_id]["points"] += n["points"]
    kp = {k.sheet_id: k for k in KpiEntry.objects.filter(sheet__in=works, week_start=ws)}
    reviews = {r.owner_id: r for r in WeeklyReview.objects.filter(week_start=ws)}
    stages = pipeline.stage_map()
    opens = [k for k, s in stages.items() if s.kind == K.OPEN]
    owners = [w.owner_id for w in works if w.owner_id]
    stuck = Counter()
    for p in Prospect.objects.filter(owner_id__in=owners, stage__in=opens).only("owner_id", "stage", "stage_since"):
        e = stages[p.stage].expected_days
        if e and p.stage_since and (team.today(st) - p.stage_since).days > e:
            stuck[p.owner_id] += 1
    touched = dict(ClientLogEntry.objects.filter(record__owner_id__in=owners, day__range=(ws, end)).order_by().values_list("record__owner_id").annotate(n=Count("record", distinct=True)))
    wins = team.wins_between(ws, end, details=False) or []
    rows, totals = [], Counter()
    for w in works:
        k, r = kp.get(w.id), reviews.get(w.owner_id)
        nums = kpis.current(k) if k else kpis.zero()
        plan = _next_plan(w, ws, st)
        row = {"work": w.id, "person": planning.person_of(w), "role": w.role.name if w.role else None, "hours": scored[w.id]["hours"], "hours_target": float(w.target_hours), "points": calc.r2(scored[w.id]["points"]),
               **{m: float(nums[m]) for m in ("leads", "opps", "clients", "revenue")}, "kpi_confirmed": bool(k and k.confirmed_at), "reviewed": bool(r and r.submitted_at), "focus": r.focus if r else "",
               "plan_status": plan["status_label"], "plan_sent": plan["done"], "deals_touched": touched.get(w.owner_id, 0), "stuck": stuck.get(w.owner_id, 0), "wins": sum(1 for x in wins if x["owner_id"] == w.owner_id)}
        rows.append(row)
        for m in ("hours", "hours_target", "points", "leads", "opps", "clients", "revenue", "wins", "stuck"):
            totals[m] += row[m]
    return {"week_start": ws, "week_end": end, "week_no": calc.week_no(ws, cfg)[0], "today": team.today(st), "current_week_start": calc.week_start_of(team.today(st), cfg), "currency": st.currency, "rows": rows, "totals": dict(totals),
            "reviewed": sum(1 for r in rows if r["reviewed"]), "plans_sent": sum(1 for r in rows if r["plan_sent"]), "wins": [{"what": x["what"], "person": x["person"], "day": x["day"]} for x in wins][:10]}


# ---------- My Progress: rings, gaps, forecast (FR-MO1, FR-G2), target vs achievement (FR-AC2), task analysis (FR-AC3) ----------

def _rows(work, st):
    t = team.today(st)
    _, rows = team.dashboard_rows(t)
    return t, next(r for r in rows if r["id"] == work.id)


def _weekly_series(work, t, cfg):
    """The last 8 full weeks' hours, points and KPIs: how much this person's weeks vary."""
    ws0 = calc.week_start_of(t, cfg)
    weeks = [ws0 - timedelta(days=7 * i) for i in range(1, 9)]
    out = {m: {w: 0.0 for w in weeks} for m in METRICS}
    for (_, d), n in scoring.day_totals([work.id], weeks[-1], ws0 - timedelta(days=1)).items():
        w = calc.week_start_of(d, cfg)
        if w in out["hours"]:
            out["hours"][w] += n["hours"]
            out["points"][w] += n["points"]
    for k in KpiEntry.objects.filter(sheet=work, week_start__in=weeks):
        for m in ("leads", "opps", "clients", "revenue"):
            out[m][k.week_start] = float(getattr(k, m) or 0)
    return {m: list(v.values()) for m, v in out.items()}


def _best_activity(work, t):
    row = (ScoreLedger.objects.filter(sheet=work, slot__isnull=False, day__gte=t - timedelta(days=60), activity__active=True).values("activity_name").annotate(n=Count("id")).order_by("-n").first())
    return row["activity_name"] if row else None


def _rates(owner_id, stages):
    """The member's own conversion, from the stages their records reached. Too few records: the stages' default probabilities, and it says so."""
    bound = {k.key: k.stage for k in KpiType.objects.select_related("stage")}
    reached = defaultdict(set)
    for rid, to in StageEvent.objects.filter(owner_id=owner_id).values_list("record_id", "to_stage"):
        s = stages.get(to)
        if s is None or s.kind == K.LOST:
            continue
        for m in ("leads", "opps", "clients"):
            if pipeline.reached(s, bound.get(m)):
                reached[m].add(rid)
    leads, opps, wins = reached["leads"], reached["opps"], reached["clients"]
    own = len(leads) >= 5 and len(opps) >= 3
    lead_s, opp_s = bound.get("leads"), bound.get("opps")
    if own:
        return {"lead_to_opp": len(opps & leads) / len(leads) or 0.1, "opp_to_client": (len(wins & opps) / len(opps)) or 0.1, "own": True}
    lead_p, opp_p = (lead_s.probability if lead_s else 10) or 10, (opp_s.probability if opp_s else 25) or 25
    return {"lead_to_opp": min(1.0, lead_p / opp_p), "opp_to_client": opp_p / 100, "own": False}


def _calls_per_lead(work, owner_id, t):
    since = t - timedelta(days=180)
    rows = ScoreLedger.objects.filter(sheet=work, slot__isnull=False, day__gte=since).order_by().values("activity_name").annotate(n=Count("id"))
    calls = sum(pc.calls_in(r["activity_name"]) * r["n"] for r in rows)
    leads = sum(k.leads for k in KpiEntry.objects.filter(sheet=work, week_start__gte=since))
    return (calls / leads if leads else None), calls


def _catch_up(work, row, stages, st, t):
    won = [k for k, s in stages.items() if s.kind == K.WON]
    values = list(Prospect.objects.filter(owner_id=work.owner_id, stage__in=won, value__isnull=False).values_list("value", flat=True)) or list(Prospect.objects.filter(owner_id=work.owner_id, value__isnull=False).values_list("value", flat=True))
    avg = float(sum(values)) / len(values) if values else None
    rates = _rates(work.owner_id, stages)
    per_lead, _ = _calls_per_lead(work, work.owner_id, t)
    gap = {m: max(0, row["kpi_targets"][m] - row["kpi_month"][m]) for m in ("leads", "opps", "clients", "revenue")}
    need = pc.catch_up(gap["revenue"], avg, int(gap["clients"]), int(gap["leads"]), rates["opp_to_client"], rates["lead_to_opp"], per_lead)
    if not need["leads"] and not need["clients"]:
        return None
    chain = []
    if gap["revenue"] and avg:
        chain.append(pc.money(gap["revenue"], st.currency))
    if need["clients"]:
        chain.append(pc.plural(need["clients"], "client"))
    if need["opps"]:
        chain.append(pc.plural(need["opps"], "opportunity", "opportunities"))
    if need["leads"]:
        chain.append(pc.plural(need["leads"], "qualified lead"))
    if need["calls"]:
        chain.append(f"~{need['calls']} calls")
    return {"chain": chain, "text": " ← ".join(chain), "basis": "Worked out from your own conversion rates." if rates["own"] else "Worked out from the stages' default rates; you don't have enough closed deals of your own yet.",
            "average_deal": avg, "calls_counted": bool(per_lead), **need}


def _analysis(work, t, st):
    """FR-AC3 over the last 30 days. Flags only ask for a second look: they never reduce points."""
    frm = t - timedelta(days=30)
    cfg = team.cfg_of(st)
    qs = ScoreLedger.objects.filter(sheet=work, day__range=(frm, t))
    hours = float(qs.aggregate(h=Sum("hours"))["h"] or 0)
    points = float(qs.aggregate(p=Sum("points"))["p"] or 0)
    mine = {r["category"] or "Other": float(r["h"] or 0) for r in qs.filter(slot__isnull=False).order_by().values("category").annotate(h=Sum("hours"))}
    peers = {}
    if work.role_id:
        rows = ScoreLedger.objects.filter(sheet__role_id=work.role_id, sheet__kind=Sheet.Kind.WORK, day__range=(frm, t), slot__isnull=False).order_by().values("category").annotate(h=Sum("hours"))
        peers = {r["category"] or "Other": float(r["h"] or 0) for r in rows}
    total_mine, total_peers = sum(mine.values()) or 1, sum(peers.values()) or 1
    mix = sorted(({"category": c, "hours": mine.get(c, 0), "share": round(mine.get(c, 0) / total_mine, 3), "expected": round(peers.get(c, 0) / total_peers, 3)} for c in set(mine) | set(peers)), key=lambda x: -x["hours"])[:10]
    entries = list(work.entries.filter(day__range=(frm, t)).order_by("day"))
    logged = deviations = 0
    days = []
    totals = scoring.day_totals([work.id], frm, t)
    for e in entries:
        for i, s in enumerate(e.slots or []):
            if s is None:
                continue
            logged += 1
            planned = e.meta_at(i).get("planned")
            deviations += planned is not None and planned != s
        days.append({"day": e.day, "slots": [x for x in (e.slots or []) if x], "remarks": e.remarks or "", "points": totals.get((work.id, e.day), scoring.ZERO)["points"]})
    plans = planning.approved_plans(work, frm, t, cfg)
    by_day = {e.day: e for e in entries}
    approved, done = 0, 0.0
    for d, row in plans.items():
        if d <= t:
            _, c, n = planning.adherence(row, by_day.get(d))
            approved, done = approved + n, done + c
    per_lead, calls = _calls_per_lead(work, work.owner_id, t)
    return {"from": frm, "to": t, "hours": hours, "points": calc.r2(points), "points_per_hour": calc.r2(points / hours) if hours else None, "mix": mix, "planned_hours": approved, "completed_hours": done,
            "adherence": round(done / approved, 2) if approved else None, "logged_hours": logged, "deviations": deviations, "deviation_rate": round(deviations / logged, 3) if logged else None,
            "calls_per_lead": round(per_lead, 1) if per_lead else None, "calls": calls, "flags": pc.quality_flags(days)}


def me(user, work_id=None):
    work = subject(user, work_id)
    st = TeamSettings.load()
    cfg = team.cfg_of(st)
    t, row = _rows(work, st)
    stages = pipeline.stage_map()
    ms, me_, ws = calc.month_start(t), calc.month_end(t), calc.week_start_of(t, cfg)
    wd_week = calc.working_days(ws, ws + timedelta(days=6), cfg)
    wd_left_week = calc.working_days(t, ws + timedelta(days=6), cfg)
    elapsed, total = calc.working_days(ms, t, cfg), calc.working_days(ms, me_, cfg)
    wd_left_month = calc.working_days(t, me_, cfg)
    today_n = scoring.day_totals([work.id], t, t).get((work.id, t), scoring.ZERO)
    _, perf = team.performance_rows(t.year, t)
    month = next(r for r in perf if r["id"] == work.id)["months"][t.month - 1]
    W = month.get("weights") or {m: 0 for m in METRICS}
    weekly = _weekly_series(work, t, cfg)
    best = _best_activity(work, t)
    month_hours = sum(n["hours"] for n in scoring.day_totals([work.id], ms, t).values())

    def line(key):
        m = METRICS[key]
        if key == "hours":
            actual, target, status = row["week_hours"], row["week_target"], row["week_status"]
        elif key == "points":
            actual, target, status = row["month_points"], row["month_target"], row["month_status"]
        else:
            actual, target = row["kpi_month"][key], row["kpi_targets"][key]
            status = calc.pace_of(actual, target, elapsed, total)
        left = max(0.0, target - actual)
        days_left = wd_left_week if key == "hours" else wd_left_month
        show = pc.money(left, st.currency) if key == "revenue" else pc.plural(calc.r2(left), m["one"], m["many"])
        if target <= 0:
            gap, action = "No target set.", None
        elif left <= 0:
            gap, action = f"Target met this {m['period']}. Well done.", None
        elif key == "hours":
            per = calc.r2(left / days_left) if days_left else left
            gap = f"You need {show} this week" + (f", about {per:g} per working day." if days_left > 1 else ".")
            action = {"label": f"Plan {best} slots" if best else "Plan your hours", "to": "/my-day?tab=plan"}
        elif key == "points":
            per = calc.r2(left / days_left) if days_left else left
            gap = f"You need {show} this month" + (f", about {per:g} per working day." if days_left > 1 else ".")
            action = {"label": "Open My Day", "to": "/my-day"}
        else:
            gap = f"You need {show} this month."
            action = {"label": "Open My Pipeline", "to": "/tracker?tab=pipeline"}
        # FR-AC2: where the month is heading, with a range
        if key == "hours":
            month_target = target * calc.days_in_month(t) / 7
            head = pc.project(month_hours, elapsed, total, weekly["hours"], wd_week)
        else:
            month_target = target
            head = pc.project(actual, elapsed, total, weekly[key], wd_week)
        return {"key": key, "label": m["label"], "means": m["means"], "period": m["period"], "actual": actual, "target": target, "status": status["key"], "status_label": PACE_LABEL.get(status["key"], ""), "pct": status.get("pct"),
                "gap": gap, "action": action, "weight": W.get(key, 0), "month_actual": month_hours if key == "hours" else actual, "month_target": month_target, "projected": head}

    lines = [line(k) for k in METRICS]
    score = month.get("score")
    forecast = pc.to_full_score(score, [{"key": k, "one": METRICS[k]["one"], "many": METRICS[k]["many"], "weight": W.get(k, 0), "target": (month.get("target") or {}).get(k, 0)} for k in ("leads", "opps", "clients")])
    if score is not None and score >= 1:
        forecast = {"key": None, "units": 0, "text": "You're at 100% this month. Everything from here is extra."}
    short = [x for x in lines if x["projected"] and x["month_target"] > 0 and x["projected"]["mid"] < x["month_target"]]
    worst = max(short, key=lambda x: x["weight"] * (1 - x["projected"]["mid"] / x["month_target"]), default=None)
    biggest = None
    if worst:
        fmt = (lambda v: pc.money(v, st.currency)) if worst["key"] == "revenue" else (lambda v: f"{v:g}")
        biggest = {"key": worst["key"], "text": f"Your biggest gap is {worst['label'].lower()}: on pace for {fmt(worst['projected']['mid'])} of {fmt(worst['month_target'])} this month." + (f" It carries {worst['weight']:g}% of your score." if worst["weight"] else "")}
    coach = _coach_on(st)
    mine = work.owner_id == user.pk
    suggestions = []
    if coach and mine:
        c = playbook._ctx(user)
        suggestions = playbook._suggestions(c)
    last_ws = ws - timedelta(days=7)
    return {
        "person": planning.person_of(work), "work": work.id, "mine": mine, "today": t, "month": f"{t:%B}", "currency": st.currency,
        "rings": {"day": {"value": today_n["hours"], "target": calc.r2(row["week_target"] / wd_week) if wd_week else 0, "unit": "h"}, "week": {"value": row["week_hours"], "target": row["week_target"], "unit": "h"},
                  "month": {"value": row["month_points"], "target": row["month_target"], "unit": "pts"}},
        "score": score, "version": month.get("version"), "forecast": forecast, "metrics": lines, "biggest_gap": biggest, "coach": coach,
        "catch_up": _catch_up(work, row, stages, st, t) if coach else None, "analysis": _analysis(work, t, st) if coach else None, "suggested": suggestions,
        "recap": recap(work, last_ws, st), "review": {"week_start": ws, "submitted": WeeklyReview.objects.filter(owner_id=work.owner_id, week_start=ws, submitted_at__isnull=False).exists(),
                                                      "due": t == _last_working_day(ws, cfg, t)},
    }


def _last_working_day(ws, cfg, t):
    d = ws + timedelta(days=6)
    while calc.dow(d) in cfg.weekend_days and d > ws:
        d -= timedelta(days=1)
    return d


# ---------- FR-AC6: the supervisor's morning brief ----------

def brief(user):
    """3 to 5 lines per member, and "Your 3 actions today", each linked to its source."""
    if not user.can_approve:
        raise NotAllowed("The morning brief is for supervisors and admins.")
    st = TeamSettings.load()
    if not _coach_on(st):
        return None
    cfg = team.cfg_of(st)
    t = team.today(st)
    prev = planning.previous_working_day(t, cfg)
    _, rows = team.dashboard_rows(t)
    rows = [r for r in rows if r["owner_id"] and r["owner_id"] != user.pk]
    ids = [r["id"] for r in rows]
    owners = [r["owner_id"] for r in rows]
    yesterday = scoring.day_totals(ids, prev, prev)
    plans = {w.id: planning.approved_plans(w, t, t, cfg).get(t) for w in Sheet.objects.filter(pk__in=ids)}
    stages = pipeline.stage_map()
    opens = [k for k, s in stages.items() if s.kind == K.OPEN]
    stuck, overdue = Counter(), Counter()
    for p in Prospect.objects.filter(owner_id__in=owners, stage__in=opens).only("owner_id", "stage", "stage_since"):
        e = stages[p.stage].expected_days
        if e and p.stage_since and (t - p.stage_since).days > e:
            stuck[p.owner_id] += 1
    for o in StepInstance.objects.filter(owner_id__in=owners, status=StepInstance.Status.OPEN, due_date__lt=t).values_list("owner_id", flat=True):
        overdue[o] += 1
    flags = set(OverloadFlag.objects.filter(owner_id__in=owners, cleared_at__isnull=True).values_list("owner_id", flat=True))
    members = []
    for r in rows:
        y = yesterday.get((r["id"], prev), scoring.ZERO)
        lines = [{"text": f"{prev:%A}: {y['hours']:g} output {'hour' if y['hours'] == 1 else 'hours'}, {y['points']:g} points.", "to": f"/my-day?work={r['id']}&day={prev}"}]
        approved = sum(1 for x in (plans.get(r["id"]) or []) if x is not None)
        lines.append({"text": f"Today's plan: {pc.plural(approved, 'approved hour')}." if approved else "No approved plan for today.", "to": f"/my-day?work={r['id']}&tab=plan"})
        lines.append({"text": f"This week: {r['week_hours']:g} of {r['week_target']:g} hours, {PACE_LABEL.get(r['week_status']['key'], '').lower()}.", "to": f"/my-progress?work={r['id']}"})
        if overdue[r["owner_id"]] or stuck[r["owner_id"]]:
            bits = [pc.plural(overdue[r["owner_id"]], "step") + " overdue" if overdue[r["owner_id"]] else "", pc.plural(stuck[r["owner_id"]], "deal") + " past the usual time" if stuck[r["owner_id"]] else ""]
            lines.append({"text": f"{' and '.join(b for b in bits if b)}.".capitalize(), "to": "/team-review"})
        if r["owner_id"] in flags:
            lines.append({"text": "Flagged Overloaded: new steps are waiting.", "to": "/frameworks"})
        members.append({"work": r["id"], "person": r["person"] or r["name"], "lines": lines[:5]})
    actions = []
    to_review = planning.mine(user).get("to_review") or 0
    if to_review:
        actions.append({"text": f"Decide {pc.plural(to_review, 'waiting hour')}", "why": "Plans, deviations and unplanned hours on the Team Board.", "to": "/team-board"})
    events = EventLog.objects.filter(status=EventLog.Status.PENDING).exclude(sheet__owner=user).count()
    wins = Prospect.objects.filter(stage__in=[k for k, s in stages.items() if s.kind == K.WON], won_verified_at__isnull=True).exclude(owner=user).count()
    if events or wins:
        actions.append({"text": f"Verify {pc.plural(events + wins, 'win or event', 'wins and events')}", "why": "They count once you've checked them.", "to": "/kpi" if wins else "/team-board"})
    if flags:
        names = [r["person"] or r["name"] for r in rows if r["owner_id"] in flags]
        actions.append({"text": f"Help {', '.join(names[:2])} catch up", "why": "Flagged Overloaded: their new steps are waiting.", "to": "/frameworks"})
    no_plan = [r["person"] or r["name"] for r in rows if not any(x is not None for x in (plans.get(r["id"]) or []))]
    if no_plan and calc.dow(t) not in cfg.weekend_days:
        actions.append({"text": f"Check in with {', '.join(no_plan[:2])}" + (f" and {len(no_plan) - 2} more" if len(no_plan) > 2 else ""), "why": "No approved plan for today.", "to": "/team-board"})
    if sum(stuck.values()):
        actions.append({"text": f"Look at {pc.plural(sum(stuck.values()), 'stuck deal')}", "why": "Past the usual time in their stage.", "to": "/team-review"})
    return {"day": t, "actions": actions[:3], "members": members}


# ---------- FR-AC4: a record's next step ----------

def record_coach(user, record_id):
    p = Prospect.objects.filter(pk=record_id).first()
    if p is None or (p.owner_id != user.pk and not _sees_team(user)):
        raise NotAllowed("This record belongs to someone else.")
    st = TeamSettings.load()
    if not _coach_on(st):
        return None
    t = team.today(st)
    stages = pipeline.stage_map()
    s = stages.get(p.stage)
    step = StepInstance.objects.filter(record=p, status=StepInstance.Status.OPEN).order_by("due_date", "position").first()
    closed = [k for k, x in stages.items() if x.kind in (K.WON, K.LOST)]
    qs = Prospect.objects.filter(stage__in=closed).exclude(pk=p.pk)
    same = qs.filter(segment__iexact=p.segment) if p.segment else qs.none()
    if p.industry:
        same = same | qs.filter(industry__iexact=p.industry)
    similar = []
    for x in same.distinct().order_by("-stage_since")[:5]:
        kind = stages[x.stage].kind
        similar.append({"outcome": "Won" if kind == K.WON else "Lost", "who": x.company if x.owner_id == user.pk else "A teammate's deal", "why": x.win_loss_why or x.lost_reason, "lesson": x.win_loss_lesson, "day": x.stage_since})
    return {"next": {"text": step.title, "due": step.due_date, "from": "framework"} if step else {"text": p.next_action, "due": p.next_follow_up, "from": "record"}, "last_contact": p.last_contacted,
            "days_in_stage": (t - p.stage_since).days if p.stage_since else None, "stage": s.name if s else p.stage, "expected_days": s.expected_days if s else None, "exit_criteria": s.exit_criteria if s else "", "similar": similar}
