"""The Daily Playbook's rules (SRS v0.5 §5.8, FR-DP1–DP11; suggestions FR-AC1, FR-AC8).

P0 Fix now · P1 Planned · P2 Framework steps due today · P3 My Tasks · P4 Carry-over · P5 Suggested (at most three) · P6 Reminders.

Everything is worked out from its source each time, so it's always live (FR-DP6). Doing the work happens where it always did (a step's
outcome, a task's Done, an hour's status), and the list simply follows. The day ring counts P0 to P4 and the closing items by weight;
suggestions and reminders stay out of it, and it never touches a score (FR-DP4, §7).
"""
from copy import deepcopy
from datetime import datetime, time, timedelta
from types import SimpleNamespace

from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone

from accounts.models import User
from core import audit
from frameworks import services as fw
from frameworks.models import StepInstance, StepType
from frameworks.serializers import StepInstanceSerializer
from mytasks.models import PersonalTask
from scoring import services as scoring
from scoring.models import EventLog, ScoreLedger
from team import calc, planning
from team import services as team
from team.models import SLOTS, KpiEntry, SheetEntry, Task, TeamSettings, WeekPlan
from tracker import pipeline
from tracker.models import ClientLogEntry, KpiType, PipelineStage, Prospect, StageEvent

from .models import AiSuggestion, PlaybookDay, PlaybookItem

GROUPS = ("fix", "planned", "step", "task", "carry")
GROUP_LABEL = {"fix": "Fix now", "planned": "Planned", "step": "Steps due today", "task": "My Tasks", "carry": "Carried over"}
DECIDE_AFTER = 3            # P4: after 3 working days an item asks to be rescheduled, dropped or added to the plan
UNTOUCHED_DAYS = 14         # P5: "Opportunity untouched for 14 days"
MAX_SUGGESTIONS = 3
APPROVAL_WINDOW = timedelta(hours=48)     # §6: the default deviation window

# FR-DP11: sources, weights, caps, closing items, phase labels and message tone are configurable.
DEFAULTS = {
    "do_now_cap": 7,
    "close_hour": 17,
    "weights": {"fix": 3, "planned": 2, "step": 2, "task": 1, "closing": 1},
    "sources": {"fix": True, "planned": True, "step": True, "task": True, "carry": True, "suggested": True, "reminders": True},
    "closing": {"timesheet": True, "client_log": True, "missed": True, "tomorrow": True, "note": True},
    "phases": {"morning": "Morning", "execute": "Execute", "close": "Close the day"},
    "tone": "warm",
}
TONES = {
    "warm": {"empty": "A clear day. A good time to plan ahead.", "start": "Your day is ready when you are.", "low": "A good start. One thing at a time.",
             "mid": "Nicely on your way.", "high": "Nearly there.", "full": "Everything's done. Well done.", "closed": "Day closed. Thank you for today."},
    "plain": {"empty": "Nothing on the list.", "start": "Your list is ready.", "low": "In progress.", "mid": "In progress.", "high": "Nearly finished.", "full": "All done.",
              "closed": "Day closed."},
}


class PlaybookError(Exception):
    """The request doesn't make sense as asked (HTTP 400)."""


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


def config(st=None):
    out = deepcopy(DEFAULTS)
    for k, v in ((st or TeamSettings.load()).playbook or {}).items():
        if isinstance(out.get(k), dict) and isinstance(v, dict):
            out[k].update(v)
        elif k in out:
            out[k] = v
    return out


def clean_config(v):
    """Team setup's Daily Playbook settings, checked. Raises ValueError with what's wrong."""
    if not isinstance(v, dict):
        raise ValueError("The Playbook settings must be an object.")
    out = {}

    def number(key, low, high, label):
        try:
            n = int(v[key])
        except (TypeError, ValueError):
            raise ValueError(f"{label} must be a whole number.")
        if not low <= n <= high:
            raise ValueError(f"{label} must be from {low} to {high}.")
        return n

    if "do_now_cap" in v:
        out["do_now_cap"] = number("do_now_cap", 1, 30, "Do now")
    if "close_hour" in v:
        out["close_hour"] = number("close_hour", 0, 23, "The closing hour")
    if "weights" in v:
        out["weights"] = {}
        for k in DEFAULTS["weights"]:
            if k in v["weights"]:
                try:
                    out["weights"][k] = max(0, min(10, int(v["weights"][k])))
                except (TypeError, ValueError):
                    raise ValueError("Weights must be whole numbers.")
    for section in ("sources", "closing"):
        if section in v:
            out[section] = {k: bool(v[section][k]) for k in DEFAULTS[section] if k in v[section]}
    if "phases" in v:
        out["phases"] = {k: " ".join(str(v["phases"][k]).split())[:30] for k in DEFAULTS["phases"] if k in v["phases"]}
        if not all(out["phases"].values()):
            raise ValueError("Give each phase a name.")
    if "tone" in v:
        if v["tone"] not in TONES:
            raise ValueError("Choose a message tone.")
        out["tone"] = v["tone"]
    return out


def _ctx(user):
    if user.role == User.Role.VIEWER:
        raise NotAllowed("The Daily Playbook is for people who do the work. Management sees the Dashboard.")
    st = TeamSettings.load()
    t = team.today(st)
    work = planning.work_of_user(user)
    start = datetime.combine(t, time.min, tzinfo=st.zone)
    done_marks = set(PlaybookItem.objects.filter(day__owner=user, day__day__gte=t - timedelta(days=14), done_at__isnull=False, key__regex=r"^(deviation|missed):").values_list("key", flat=True))
    return SimpleNamespace(user=user, st=st, cfg=team.cfg_of(st), conf=config(st), t=t, now=team.now(), work=work, cal=fw.Calendar(st), start=start, end=start + timedelta(days=1),
                           stages=pipeline.stage_map(), tasks={x.id: x for x in Task.objects.all()}, acked=done_marks,
                           entry=SheetEntry.objects.filter(sheet=work, day=t).first() if work else None)


def _item(c, key, group, title, *, detail="", done=False, to="", source=(None, None), sticky=False, weight_as=None, **extra):
    return {"key": key, "group": group, "group_label": GROUP_LABEL[group], "title": title[:240], "detail": (detail or "")[:240], "done": done, "to": to, "sticky": sticky,
            "source": {"type": source[0], "id": source[1]}, "weight": c.conf["weights"][weight_as or group], **extra}


def _record_to(pk):
    return f"/tracker?tab=pipeline&record={pk}"


def _short(d):
    """9 Nov, as the rest of the app writes it."""
    return f"{d.day} {d:%b}"


# ---------- P0 Fix now ----------

def _overdue_approvals(c):
    """§6: hours that have waited longer than the window for this supervisor's decision."""
    n = 0
    plans = WeekPlan.objects.filter(status=WeekPlan.Status.SUBMITTED, submitted_at__lte=c.now - APPROVAL_WINDOW).exclude(sheet__owner=c.user)
    for states in plans.values_list("slot_states", flat=True):
        n += sum(1 for v in (states or {}).values() for x in v if x == planning.SUBMITTED)
    cut = c.t - timedelta(days=2)
    for meta in (SheetEntry.objects.filter(sheet__kind="work", day__gte=c.t - timedelta(days=60), day__lte=cut, meta__contains=[{"review": planning.PENDING}])
                 .exclude(sheet__owner=c.user).values_list("meta", flat=True)):
        n += sum(1 for m in meta if m and m.get("review") == planning.PENDING)
    return n


def _fix(c, mine):
    out = []
    for field, label in (("this_week", "this week"), ("next_week", "next week")):
        w = mine.get(field)
        if w and w["rejected"]:
            n = w["rejected"]
            out.append(_item(c, f"plan-rejected:{w['start']}", "fix", f"{n} planned {'hour was' if n == 1 else 'hours were'} sent back for {label}", detail="Change them and send the plan again.",
                             to=f"/my-day?tab=plan&day={w['start']}", source=("plan", None), sticky=True, cta="Open the plan"))
    if c.work:
        prev = planning.previous_working_day(c.t, c.cfg)
        for e in c.work.entries.filter(day__range=(prev, c.t)):
            for i, m in enumerate(e.meta or []):
                key = f"deviation:{e.day}:{i}"
                if m and m.get("review") == planning.REJECTED and key not in c.acked:
                    out.append(_item(c, key, "fix", f"H-{i + 1}, {e.day:%a} {_short(e.day)}: the different task wasn't approved", detail=m.get("note") or "It doesn't count. The planned task is marked not done.",
                                     to=f"/my-day?day={e.day}", source=("entry", e.id), sticky=True, acknowledge=True, cta="See the day"))
    first = pipeline.first_stage()
    if first:
        busy = set(StepInstance.objects.filter(owner=c.user, status__in=fw.WAITING).values_list("record_id", flat=True))
        for p in Prospect.objects.filter(owner=c.user, stage=first.key, last_contacted__isnull=True).exclude(pk__in=busy).order_by("created_at")[:10]:
            out.append(_item(c, f"lead:{p.id}", "fix", f"{p.company}: new lead waiting for first contact", detail=p.requirement, to=_record_to(p.id), source=("record", p.id), sticky=True, cta="Open the record"))
    if c.user.can_approve:
        old = _overdue_approvals(c)
        if old:
            out.append(_item(c, "approvals", "fix", f"{old} {'hour has' if old == 1 else 'hours have'} waited over two days for your decision", to="/team-board", source=("board", None), sticky=True, cta="Open the Team Board"))
    if c.work:
        ws = calc.week_start_of(c.t, c.cfg) - timedelta(days=7)
        k = KpiEntry.objects.filter(sheet=c.work, week_start=ws).first()
        if team.kpi_derived(c.st, ws):
            if k and not k.confirmed_at and (k.leads or k.opps or k.clients or k.revenue):
                out.append(_item(c, f"kpi:{ws}", "fix", "Last week's KPIs are waiting for your confirmation", detail="One tap: the numbers come from your pipeline.", to="/kpi", source=("kpi", k.id), sticky=True, cta="Confirm them"))
        elif (k is None or not (k.leads or k.opps or k.clients or k.revenue)) and (not c.work.start_date or c.work.start_date <= ws):
            out.append(_item(c, f"kpi:{ws}", "fix", "Last week's results aren't in yet", to="/kpi", source=("kpi", None), sticky=True, cta="Enter them"))
    return out


# ---------- P1 Planned, P2 Steps, P3 Tasks, P4 Carry-over ----------

def _planned(c):
    if not c.work:
        return []
    approved = planning.approved_plans(c.work, c.t, c.t, c.cfg).get(c.t) or []
    out = []
    for i, task_id in enumerate(approved):
        if task_id is None:
            continue
        m = c.entry.meta_at(i) if c.entry else {}
        logged = (c.entry.slots[i] if c.entry and i < len(c.entry.slots) else None)
        status = m.get("status") or ("done" if logged is not None else None)
        task = c.tasks.get(task_id)
        out.append(_item(c, f"slot:{i}", "planned", f"H-{i + 1} {task.name if task else 'Planned task'}", detail=task.type if task else "", done=status is not None, to=f"/my-day?day={c.t}", source=("slot", i),
                         slot={"hour": i, "task": task_id, "status": status, "reason": m.get("reason") or "", "other": logged is not None and logged != task_id}))
    return out


def _missed(c):
    """Yesterday's approved hours with nothing logged. The day is locked, so they carry as something to do today or let go (FR-DP7)."""
    if not c.work:
        return []
    prev = planning.previous_working_day(c.t, c.cfg)
    approved = planning.approved_plans(c.work, prev, prev, c.cfg).get(prev) or []
    if not any(approved):
        return []
    e = SheetEntry.objects.filter(sheet=c.work, day=prev).first()
    today = list(c.entry.slots) if c.entry else []
    out = []
    for i, task_id in enumerate(approved):
        key = f"missed:{prev}:{i}"
        m = e.meta_at(i) if e else {}
        if task_id is None or key in c.acked or m.get("status") == "not_done" or (e and i < len(e.slots) and e.slots[i] is not None):
            continue
        task = c.tasks.get(task_id)
        out.append(_item(c, key, "carry", f"H-{i + 1} {task.name if task else 'Planned task'}, planned for {prev:%a}", detail="Nothing was logged for it.", done=task_id in today, to=f"/my-day?day={c.t}", source=("slot", i), sticky=True,
                         weight_as="planned", carried=True, acknowledge=True, cta="Log it today"))
    return out


def _steps(c):
    qs = (StepInstance.objects.filter(owner=c.user).filter(Q(status=StepInstance.Status.OPEN, due_date__lte=c.t) | Q(status=StepInstance.Status.DONE, done_at__gte=c.start, done_at__lt=c.end))
          .select_related("assignment__framework", "activity", "record").order_by("due_date", "position", "attempt"))
    ctx = {"today": c.t}
    out = []
    for s in qs:
        carried = s.due_date < c.t
        waited = c.cal.between(s.due_date, c.t) if carried else 0
        out.append(_item(c, f"step:{s.id}", "carry" if carried else "step", f"Day {s.day_offset}: {s.title}", detail=s.record.company + (f" · try {s.attempt}" if s.attempt > 1 else ""),
                         done=s.status == StepInstance.Status.DONE, to=_record_to(s.record_id), source=("step", s.id), weight_as="step", carried=carried, waited=waited,
                         decide=carried and waited >= DECIDE_AFTER and s.status == StepInstance.Status.OPEN, step=StepInstanceSerializer(s, context=ctx).data))
    return out


def _tasks(c):
    T = PersonalTask.Status
    qs = (PersonalTask.objects.filter(owner=c.user).filter(Q(status=T.OPEN, due_date__lte=c.t) | Q(status=T.DONE, done_at__gte=c.start, done_at__lt=c.end))
          .select_related("client", "activity", "assigned_by").order_by("due_date", "due_time", "id"))
    out = []
    for x in qs:
        carried = x.due_date < c.t
        waited = c.cal.between(x.due_date, c.t) if carried else 0
        who = x.assigned_by.name or x.assigned_by.email if x.assigned_by else ""
        bits = [f"{x.due_time:%H:%M}" if x.due_time else "", f"Assigned by {who}" if who else "", x.client.company if x.client else ""]
        out.append(_item(c, f"task:{x.id}", "carry" if carried else "task", x.title, detail=" · ".join(b for b in bits if b), done=x.status == T.DONE, to="/my-tasks", source=("task", x.id), weight_as="task", carried=carried, waited=waited,
                         decide=carried and waited >= DECIDE_AFTER and x.status == T.OPEN, task={"id": x.id, "title": x.title, "activity": x.activity_id, "activity_name": x.activity.name if x.activity else None, "assigned": bool(x.assigned_by_id), "due_date": x.due_date}))
    return out


def _next_steps(c, skip):
    """A dated next action on a record with no framework steps: the Playbook replaces the old "next step" lists (§5.8, FR-CL3)."""
    busy = set(StepInstance.objects.filter(owner=c.user, status__in=fw.WAITING).values_list("record_id", flat=True))
    opens = [k for k, s in c.stages.items() if s.kind == PipelineStage.Kind.OPEN]
    out = []
    for p in Prospect.objects.filter(owner=c.user, stage__in=opens, next_follow_up__lte=c.t).exclude(pk__in=busy | skip).order_by("next_follow_up")[:30]:
        carried = p.next_follow_up < c.t
        out.append(_item(c, f"next:{p.id}", "carry" if carried else "step", f"{p.company}: {p.next_action or 'Follow up'}", detail=c.stages[p.stage].name, to=_record_to(p.id), source=("record", p.id), sticky=True, weight_as="step", carried=carried, cta="Open the record"))
    return out


def _collect(c, mine):
    on = c.conf["sources"]
    fix = _fix(c, mine) if on["fix"] else []
    steps, tasks = _steps(c), _tasks(c)
    skip = {i["source"]["id"] for i in fix if i["source"]["type"] == "record"}
    nexts = _next_steps(c, skip)
    rows = fix + (_planned(c) if on["planned"] else [])
    rows += [i for i in steps + nexts if i["group"] == "step" and on["step"]] + [i for i in tasks if i["group"] == "task" and on["task"]]
    if on["carry"]:
        rows += _missed(c) + [i for i in steps + nexts + tasks if i["group"] == "carry"]
    return rows


def _sync(c, pd, items):
    """Record what's on today's list. A sticky item that left the list was dealt with, so it stays on the ring as done; anything else
    that left (a task moved to another day) just goes."""
    rows = {r.key: r for r in pd.items.all()}
    now = timezone.now()
    seen = set()
    for it in items:
        seen.add(it["key"])
        r = rows.get(it["key"])
        if r is None:
            r = PlaybookItem.objects.create(day=pd, key=it["key"], group=it["group"], source_type=it["source"]["type"] or "", source_id=it["source"]["id"], title=it["title"], detail=it["detail"], to=it["to"],
                                            weight=it["weight"], sticky=it["sticky"], done_at=now if it["done"] else None)
            continue
        if bool(r.done_at) != it["done"] or r.title != it["title"] or r.weight != it["weight"]:
            r.done_at = (r.done_at or now) if it["done"] else None
            r.title, r.weight = it["title"], it["weight"]
            r.save(update_fields=["done_at", "title", "weight"])
    out = list(items)
    for key, r in rows.items():
        if key in seen:
            continue
        if r.sticky:
            if r.done_at is None:
                r.done_at = now
                r.save(update_fields=["done_at"])
            out.append({"key": key, "group": r.group, "group_label": GROUP_LABEL.get(r.group, ""), "title": r.title, "detail": r.detail, "done": True, "to": r.to, "sticky": True,
                        "source": {"type": r.source_type or None, "id": r.source_id}, "weight": r.weight})
        else:
            r.delete()
    return out


# ---------- P5 Suggested (FR-AC1, FR-AC8), P6 Reminders ----------

def _gaps(c):
    """How far each KPI is from this month's target, 0 to 1. With no target it still counts a little, so records aren't ignored."""
    if not c.work:
        return {}
    book = scoring.Book()
    T = book.targets(c.work, c.t)
    got = calc.kpi_for(team.kpi_rows(c.work), lambda k: calc.counted_month(k) == (c.t.year, c.t.month))
    return {m: (max(0.0, 1 - got[m] / T[m]) if T.get(m) else 0.25) for m in calc.KPI_KEYS}


def _conversion(c):
    """{stage key: the member's own share of records that reached it and went on to be won}. Under five records, the stage's own probability."""
    events = list(StageEvent.objects.filter(owner=c.user).values_list("record_id", "to_stage"))
    won = {k for k, s in c.stages.items() if s.kind == PipelineStage.Kind.WON}
    won_records = {r for r, to in events if to in won}
    out = {}
    for key, s in c.stages.items():
        if s.kind != PipelineStage.Kind.OPEN:
            continue
        reached = {r for r, to in events if to in c.stages and c.stages[to].kind != PipelineStage.Kind.LOST and c.stages[to].position >= s.position}
        out[key] = (len(reached & won_records) / len(reached)) if len(reached) >= 5 else (s.probability or 5) / 100
    return out


def _candidates(c):
    gaps, conv = _gaps(c), _conversion(c)
    bound = {k.key: k.stage for k in KpiType.objects.select_related("stage")}
    opens = {k: s for k, s in c.stages.items() if s.kind == PipelineStage.Kind.OPEN}
    out = []
    for p in Prospect.objects.filter(owner=c.user, stage__in=opens):
        s = opens[p.stage]
        is_opp = pipeline.reached(s, bound.get("opps"))
        metric = "revenue" if is_opp else "opps" if pipeline.reached(s, bound.get("leads")) else "leads"
        rank = gaps.get(metric, 0.25) * conv.get(p.stage, 0.05)
        gap_word = {"revenue": "revenue", "opps": "opportunities", "leads": "qualified leads"}[metric]
        where = "Opportunity" if is_opp else "Lead"
        if p.last_contacted:
            quiet = (c.t - p.last_contacted).days
            why = f"Last contact {_short(p.last_contacted)}."
        else:
            quiet = (c.t - p.created_at.date()).days
            why = "No contact logged since it was added."
        if quiet >= UNTOUCHED_DAYS:
            out.append({"key": f"untouched:{p.id}", "rule": "untouched", "record": p, "rank": rank, "action": "Open the record", "title": f"{where} untouched for {quiet} days: call {p.company} today?",
                        "why": f"{why} It's at {s.name}, and you're behind on {gap_word} this month."[:400]})
        elif s.expected_days and p.stage_since and (c.t - p.stage_since).days > s.expected_days:
            n = (c.t - p.stage_since).days
            out.append({"key": f"stalled:{p.id}", "rule": "stalled", "record": p, "rank": rank * 0.9, "action": "Open the record", "title": f"{p.company} has been at {s.name} for {n} days (usually {s.expected_days})",
                        "why": (f"To move on: {s.exit_criteria}." if s.exit_criteria else "It may need a push, or to be closed.")[:400]})
    return sorted(out, key=lambda x: (-x["rank"], x["key"]))


def _suggestions(c):
    """At most three a day, ranked by target gap × the member's own conversion rate (FR-AC1). They stay put for the day; one that's
    dismissed doesn't come back. With suggestions switched off the Playbook works just the same (acceptance test 13)."""
    if not c.conf["sources"]["suggested"]:
        return []
    have = {s.key: s for s in AiSuggestion.objects.filter(owner=c.user, day=c.t).select_related("record")}
    live = [s for s in have.values() if s.dismissed_at is None]
    if len(live) < MAX_SUGGESTIONS:
        for x in _candidates(c):
            if len(live) >= MAX_SUGGESTIONS:
                break
            if x["key"] not in have:
                live.append(AiSuggestion.objects.create(owner=c.user, day=c.t, key=x["key"], rule=x["rule"], title=x["title"][:240], why=x["why"], record=x["record"], action=x["action"], rank=x["rank"]))
    live.sort(key=lambda s: (-s.rank, s.id))
    return [{"id": s.id, "title": s.title, "why": s.why, "action": s.action, "to": _record_to(s.record_id) if s.record_id else "", "feedback": s.feedback} for s in live[:MAX_SUGGESTIONS]]


def _reminders(c, mine):
    if not c.conf["sources"]["reminders"]:
        return []
    out = []
    opens = [k for k, s in c.stages.items() if s.kind == PipelineStage.Kind.OPEN]
    for p in Prospect.objects.filter(owner=c.user, stage__in=opens, tender_deadline__range=(c.t, c.t + timedelta(days=2))).order_by("tender_deadline"):
        n = (p.tender_deadline - c.t).days
        out.append({"key": f"tender:{p.id}", "icon": "tender", "title": f"Tender closes {'today' if n == 0 else 'tomorrow' if n == 1 else f'in {n} days'}: {p.company}", "to": _record_to(p.id)})
    for s in StepInstance.objects.filter(owner=c.user, status=StepInstance.Status.OPEN, due_date=c.t, type__in=[StepType.VISIT, StepType.DEMO]).select_related("record"):
        out.append({"key": f"meeting:{s.id}", "icon": "meeting", "title": f"Meeting today: {s.record.company} ({s.title})", "to": _record_to(s.record_id)})
    if c.work:
        we = calc.week_start_of(c.t, c.cfg) + timedelta(days=6)
        last = we
        while calc.dow(last) in c.cfg.weekend_days and last > c.t:
            last -= timedelta(days=1)
        from progress.models import WeeklyReview       # progress builds on the Playbook, so it's imported here
        done = WeeklyReview.objects.filter(owner=c.user, week_start=calc.week_start_of(c.t, c.cfg), submitted_at__isnull=False).exists()
        if c.t == last and not done:
            out.append({"key": "review-due", "icon": "kpi", "title": "Your Weekly Review is due: ten minutes to wrap up the week", "to": "/weekly-review"})
    this_week, next_week = mine.get("this_week"), mine.get("next_week")
    if this_week and this_week["status"] == WeekPlan.Status.SUBMITTED:
        out.append({"key": "plan-waiting", "icon": "approval", "title": "Your plan is waiting for approval", "to": "/my-day?tab=plan"})
    if next_week and next_week.get("due") and not next_week["status"]:
        out.append({"key": "plan-due", "icon": "approval", "title": "Next week's plan is due", "to": f"/my-day?tab=plan&day={next_week['start']}"})
    if mine.get("to_review"):
        n = mine["to_review"]
        out.append({"key": "to-review", "icon": "approval", "title": f"{n} {'hour waits' if n == 1 else 'hours wait'} for your decision", "to": "/team-board"})
    if c.user.can_approve:
        n = EventLog.objects.filter(status=EventLog.Status.PENDING).exclude(sheet__owner=c.user).count()
        if n:
            out.append({"key": "events", "icon": "approval", "title": f"{n} {'event' if n == 1 else 'events'} to verify", "to": "/team-board"})
    flag = fw.check(c.user.pk, c.st)
    if flag and not flag.overridden_at:
        n = StepInstance.objects.filter(owner=c.user, status=StepInstance.Status.HELD).count()
        if n:
            out.append({"key": "held", "icon": "held", "title": f"{n} new {'step is' if n == 1 else 'steps are'} waiting while you catch up", "to": "/tracker"})
    return out


# ---------- close the day (FR-DP3), light days (FR-DP8), the ring (FR-DP4) ----------

def _closing(c, pd, planned):
    on = dict(c.conf["closing"])
    if not c.work:                         # no daily log (an admin): no timesheet or plan to close
        on.update(timesheet=False, missed=False, tomorrow=False)
    out = []
    logged = calc.day_hours(c.entry.slots) if c.entry else 0
    open_slots = [i for i in planned if not i["done"]]
    if on["timesheet"]:
        out.append({"key": "timesheet", "label": "Timesheet complete", "done": logged > 0 or (bool(planned) and not open_slots), "to": f"/my-day?day={c.t}",
                    "hint": f"{logged} {'hour' if logged == 1 else 'hours'} logged today" if logged else "Nothing logged yet"})
    if on["client_log"]:
        touched = set(PersonalTask.objects.filter(owner=c.user, status=PersonalTask.Status.DONE, done_at__gte=c.start, done_at__lt=c.end, client__isnull=False).values_list("client_id", flat=True))
        touched |= set(StageEvent.objects.filter(by=c.user, day=c.t, baseline=False).exclude(from_stage="").values_list("record_id", flat=True))
        logged_on = set(ClientLogEntry.objects.filter(by=c.user, day=c.t).exclude(type=ClientLogEntry.Type.STAGE).values_list("record_id", flat=True))
        missing = touched - logged_on
        out.append({"key": "client_log", "label": "Client Log updated", "done": not missing, "to": "/tracker",
                    "hint": "No clients touched today" if not touched else f"{len(missing)} {'client' if len(missing) == 1 else 'clients'} still to log" if missing else f"{len(touched)} {'client' if len(touched) == 1 else 'clients'} up to date"})
    if on["missed"]:
        out.append({"key": "missed", "label": "Missed hours explained", "done": not open_slots, "to": f"/my-day?day={c.t}",
                    "hint": f"{len(open_slots)} planned {'hour' if len(open_slots) == 1 else 'hours'} still open" if open_slots else "Nothing left open"})
    if on["tomorrow"]:
        next_day = c.cal.first(c.t + timedelta(days=1))
        sent = False
        if c.work:
            plan_sheet = planning.plan_sheet_for(c.work)
            p = WeekPlan.objects.filter(sheet=plan_sheet, week_start=calc.week_start_of(next_day, c.cfg)).first() if plan_sheet else None
            sent = bool(p) and any(s in (planning.SUBMITTED, planning.APPROVED) for s in planning.states_of(p, next_day))
        out.append({"key": "tomorrow", "label": "Tomorrow's plan submitted", "done": sent, "to": f"/my-day?tab=plan&day={next_day}", "hint": f"{next_day:%A} {_short(next_day)}"})
    if on["note"]:
        out.append({"key": "note", "label": "Day note", "done": bool(pd.note.strip()), "optional": True, "to": "", "hint": "Optional"})
    return out


def _ring(c, pd, items, closing):
    w = c.conf["weights"]["closing"]
    required = [x for x in closing if not x.get("optional")]
    total = sum(i["weight"] for i in items) + w * len(required)
    done = sum(i["weight"] for i in items if i["done"]) + w * sum(1 for x in required if x["done"])
    pct = round(100 * done / total) if total else None
    words = TONES[c.conf["tone"]]
    if pd.closed_at:
        message = words["closed"]
    elif pct is None:
        message = words["empty"]
    elif not pd.opened_at:
        message = words["start"]
    else:
        message = words["full"] if pct >= 100 else words["high"] if pct >= 75 else words["mid"] if pct >= 40 else words["low"]
    return {"pct": pct, "done": done, "total": total, "message": message}


def _light(c, open_items):
    """FR-DP8: with little on the list and free hours left, the best use of them from the target gap."""
    if not c.work or len(open_items) > 2:
        return None
    logged = calc.day_hours(c.entry.slots) if c.entry else 0
    free = SLOTS - logged - sum(1 for i in open_items if i["group"] == "planned")
    if free <= 0:
        return None
    ws = calc.week_start_of(c.t, c.cfg)
    done = sum(n["hours"] for n in scoring.day_totals([c.work.id], ws, ws + timedelta(days=6)).values())
    gap = scoring.Book().targets(c.work, c.t)["hours"] - done
    best = (ScoreLedger.objects.filter(sheet=c.work, slot__isnull=False, day__gte=c.t - timedelta(days=30), activity__active=True).values("activity_name").annotate(p=Avg("points"), n=Count("id")).filter(n__gte=2).order_by("-p", "-n").first())
    need = f"You need {gap:g} more output {'hour' if gap == 1 else 'hours'} this week." if gap > 0 else "You've met this week's hours."
    tip = f" {best['activity_name']} has earned you the most lately." if best else ""
    return {"free_hours": free, "message": f"A light day: {free} free {'hour' if free == 1 else 'hours'}. {need}{tip}", "to": f"/my-day?day={c.t}", "action": "Fill them in"}


def _elapsed(c, pd):
    """FR-DP10: from Start my day until Close my day; if it's never clicked, it stops at the end of the day."""
    if not pd.opened_at:
        return 0, False
    if pd.closed_at:
        return int((pd.closed_at - pd.opened_at).total_seconds()), False
    return int((min(c.now, c.end) - pd.opened_at).total_seconds()), c.now < c.end


# ---------- the supervisor's lens (FR-DP9) ----------

def _lens(c):
    """Approvals due, who hasn't closed yesterday, overloaded members, stuck deals, recognition prompts. Completion %, never private task contents."""
    if not c.user.can_approve:
        return None
    _, rows = team.dashboard_rows(c.t)
    prev = planning.previous_working_day(c.t, c.cfg)
    owners = [r["owner_id"] for r in rows if r["owner_id"] and r["owner_id"] != c.user.pk]
    days = {(d.owner_id, d.day): d for d in PlaybookDay.objects.filter(owner_id__in=owners, day__in=[c.t, prev])}
    opens = [k for k, s in c.stages.items() if s.kind == PipelineStage.Kind.OPEN]
    stuck = {}
    for p in Prospect.objects.filter(owner_id__in=owners, stage__in=opens).only("owner_id", "stage", "stage_since"):
        e = c.stages[p.stage].expected_days
        if e and p.stage_since and (c.t - p.stage_since).days > e:
            stuck[p.owner_id] = stuck.get(p.owner_id, 0) + 1
    flags = {f.owner_id: f for f in fw.OverloadFlag.objects.filter(owner_id__in=owners, cleared_at__isnull=True)}
    people, prompts = [], []
    for r in rows:
        o = r["owner_id"]
        if not o or o == c.user.pk:
            continue
        name = r["person"] or r["name"]
        today, before = days.get((o, c.t)), days.get((o, prev))
        people.append({"id": o, "name": name, "work": r["id"], "started": bool(today and today.opened_at), "closed": bool(today and today.closed_at), "pct": (today.snapshot or {}).get("pct") if today else None,
                       "yesterday_closed": bool(before and before.closed_at), "overloaded": o in flags, "stuck": stuck.get(o, 0)})
        if r["last_week_status"]["key"] == "met":
            prompts.append(f"{name} hit last week's hours target. Send a word of thanks?")
    n = planning.mine(c.user).get("to_review") or 0
    return {"approvals": n + EventLog.objects.filter(status=EventLog.Status.PENDING).exclude(sheet__owner=c.user).count(), "people": people, "unclosed": sum(1 for p in people if not p["yesterday_closed"]), "yesterday": prev,
            "overloaded": sum(1 for p in people if p["overloaded"]), "stuck": sum(stuck.values()), "prompts": prompts[:3]}


# ---------- the day ----------

def build(user):
    c = _ctx(user)
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    mine = planning.mine(user)
    items = _sync(c, pd, _collect(c, mine))
    closing = _closing(c, pd, [i for i in items if i["group"] == "planned"])
    ring = _ring(c, pd, items, closing)
    order = {g: n for n, g in enumerate(GROUPS)}
    open_items = sorted([i for i in items if not i["done"]], key=lambda i: order.get(i["group"], 9))
    cap = c.conf["do_now_cap"]
    elapsed, running = _elapsed(c, pd)
    has_fix = any(i["group"] == "fix" for i in open_items)
    local_hour = c.now.astimezone(c.st.zone).hour
    phase = "closed" if pd.closed_at else "morning" if not pd.opened_at or has_fix else "close" if not open_items or local_hour >= c.conf["close_hour"] else "execute"
    if pd.closed_at:
        primary = None
    elif not pd.opened_at:
        primary = {"kind": "open", "label": "Start my day"}
    elif phase == "close":
        primary = {"kind": "close", "label": "Close my day"}
    else:
        primary = {"kind": "item", "label": "Fix this first" if has_fix else "Do the next item", "item": open_items[0]["key"]}
    snap = {"pct": ring["pct"], "done": ring["done"], "total": ring["total"], "items": len(items), "open": len(open_items), "closed": bool(pd.closed_at), "seconds": elapsed,
            "closing": sum(1 for x in closing if x["done"] and not x.get("optional"))}
    if pd.snapshot != snap:
        pd.snapshot = snap
        pd.save(update_fields=["snapshot", "updated_at"])
    counts = {g: sum(1 for i in items if i["group"] == g) for g in GROUPS}
    return {
        "day": c.t, "phase": phase, "phase_labels": c.conf["phases"], "primary": primary, "opened_at": pd.opened_at, "closed_at": pd.closed_at, "elapsed_seconds": elapsed, "running": running, "note": pd.note,
        "ring": ring, "do_now": open_items[:cap], "up_next": open_items[cap:], "done": [i for i in items if i["done"]], "counts": counts, "suggested": _suggestions(c), "reminders": _reminders(c, mine),
        "closing": closing, "light": _light(c, open_items), "lens": _lens(c), "has_log": bool(c.work), "work": c.work.id if c.work else None,
    }


def start_day(user):
    c = _ctx(user)
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    if not pd.opened_at:
        pd.opened_at = c.now
        pd.save(update_fields=["opened_at", "updated_at"])
    return build(user)


def close_day(user):
    c = _ctx(user)
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    if not pd.opened_at:
        pd.opened_at = c.now
    pd.closed_at = c.now
    pd.save(update_fields=["opened_at", "closed_at", "updated_at"])
    return build(user)


def reopen_day(user):
    c = _ctx(user)
    PlaybookDay.objects.filter(owner=user, day=c.t).update(closed_at=None)
    return build(user)


def set_note(user, note):
    c = _ctx(user)
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    pd.note = (note or "").strip()[:2000]
    pd.save(update_fields=["note", "updated_at"])
    return pd.note


def quick_note(user, text, client=None):
    """FR-DP5: a note, attached to a client (it goes in the Client Log), or added to the day note."""
    c = _ctx(user)
    text = (text or "").strip()
    if len(text) < 2:
        raise PlaybookError("Write the note first.")
    if client:
        p = Prospect.objects.filter(pk=client, owner=user).first()
        if p is None:
            raise PlaybookError("Choose one of your own pipeline records.")
        pipeline.add_log(p, user, ClientLogEntry.Type.NOTE, note=text[:1000])
        return {"client": p.company}
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    pd.note = f"{pd.note}\n{text}".strip()[:2000]
    pd.save(update_fields=["note", "updated_at"])
    return {"client": None}


KEEP = ("status", "qty", "ref", "reason", "task", "step")


@transaction.atomic
def log_slot(user, hour, status, reason=""):
    """P1: Done / Partly / Not done on an approved hour, from the home screen (FR-T7). "undo" clears it again."""
    c = _ctx(user)
    if not c.work:
        raise PlaybookError("You don't have a daily log yet.")
    approved = planning.approved_plans(c.work, c.t, c.t, c.cfg).get(c.t) or []
    if not 0 <= hour < len(approved) or approved[hour] is None:
        raise PlaybookError("That hour has no approved plan.")
    slots = planning.pad(c.entry.slots if c.entry else [])
    meta = [(c.entry.meta_at(i) if c.entry else {}) for i in range(SLOTS)]
    if status in ("done", "partly"):
        slots[hour], meta[hour] = approved[hour], {"status": status}
    elif status == "not_done":
        if len(reason.strip()) < 3:
            raise PlaybookError("Say why the planned task wasn't done.")
        slots[hour], meta[hour] = None, {"status": "not_done", "reason": reason.strip()[:300]}
    elif status == "undo":
        slots[hour], meta[hour] = None, {}
    else:
        raise PlaybookError("Use done, partly or not_done.")
    team.save_entry(user, c.work, c.t, slots, c.entry.remarks if c.entry else "", [{k: m.get(k) for k in KEEP if m.get(k) is not None} or None for m in meta])
    return build(user)


@transaction.atomic
def add_to_plan(user, kind, pk):
    """P4: put a carried item in the next working day's plan, as a draft, and move it to that day."""
    c = _ctx(user)
    obj = (StepInstance if kind == "step" else PersonalTask).objects.filter(pk=pk, owner=user).first() if kind in ("step", "task") else None
    if obj is None:
        raise PlaybookError("That item isn't on your list.")
    if not obj.activity_id:
        raise PlaybookError("It has no Activity Type, so it can't go in a plan slot. Reschedule it instead.")
    if not c.work:
        raise PlaybookError("You don't have a daily log yet.")
    plan_sheet = planning.plan_sheet_for(c.work, create=True)
    day = c.cal.first(c.t + timedelta(days=1))
    e = plan_sheet.entries.filter(day=day).first()
    slots = planning.pad(e.slots if e else [])
    free = next((i for i, s in enumerate(slots) if s is None), None)
    if free is None:
        raise PlaybookError(f"The plan for {day:%A} is full.")
    slots[free] = obj.activity_id
    team.save_entry(user, plan_sheet, day, slots, e.remarks if e else "")
    obj.due_date = day
    obj.save(update_fields=["due_date", "updated_at"])
    if kind == "step":
        fw.sync_next(obj.record)
    fw.check(user.pk, c.st)
    return {"day": day, "hour": free}


def let_go(user, key, reason=""):
    """A notice that can't be fixed any more (a change that wasn't approved, yesterday's missed hour): the member says they've seen it.
    Letting a missed hour go is logged (FR-DP7)."""
    c = _ctx(user)
    if not key.startswith(("deviation:", "missed:")):
        raise PlaybookError("That item is dealt with where it lives.")
    pd, _ = PlaybookDay.objects.get_or_create(owner=user, day=c.t)
    r = PlaybookItem.objects.filter(day=pd, key=key).first()
    if r is None:
        raise PlaybookError("That item isn't on today's list.")
    r.done_at, r.note = timezone.now(), (reason or "").strip()[:300]
    r.save(update_fields=["done_at", "note"])
    audit.log(user, "playbook.let_go", r.title, key=key, reason=r.note)
    return build(user)


def suggestion_feedback(user, pk, useful):
    s = AiSuggestion.objects.filter(pk=pk, owner=user).first()
    if s is None:
        raise PlaybookError("That suggestion isn't yours.")
    s.feedback = AiSuggestion.Feedback.USEFUL if useful else AiSuggestion.Feedback.NOT_USEFUL
    s.save(update_fields=["feedback"])
    return s


def dismiss_suggestion(user, pk):
    s = AiSuggestion.objects.filter(pk=pk, owner=user).first()
    if s is None:
        raise PlaybookError("That suggestion isn't yours.")
    s.dismissed_at = timezone.now()
    s.save(update_fields=["dismissed_at"])
    return s


def history(user, days=14):
    """FR-DP6: the kept snapshots, for trends."""
    c = _ctx(user)
    rows = PlaybookDay.objects.filter(owner=user, day__lt=c.t, day__gte=c.t - timedelta(days=days))
    return [{"day": d.day, "pct": (d.snapshot or {}).get("pct"), "closed": bool(d.closed_at), "minutes": ((d.snapshot or {}).get("seconds") or 0) // 60} for d in rows]
