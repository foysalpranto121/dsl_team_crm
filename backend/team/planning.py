"""Planning, approval and the hour-log rules (SRS v0.5 §5.2, §5.3, §6).

Plan. A member plans hours for any day of a week (a whole day or some hours), from their role's tasks, and submits them.
Each planned hour has a state: draft → submitted → approved | rejected. A rejected hour counts as a draft again (it can be
changed and resubmitted). A supervisor (or admin) approves all of a plan, part of it, or edits an hour and approves it;
nobody approves their own. The week's status follows from its hours: Draft, Submitted, Approved, Partially approved,
Rejected; it is "In execution" while the week runs and "Closed" after it. A day's plan closes at the end of the previous
working day, or on the day itself, by team policy (FR-P6).

Log. Hours are logged against the approved plan. As planned → counts. A different task → a deviation: it needs a reason
and counts zero until approved. No approved plan → unplanned: counts provisionally, or zero until approved in strict mode
(D1). A supervisor can flag any logged hour; flagged hours lose their points. An approved hour can be marked Not done,
with a reason. Adherence = completed approved hours ÷ approved hours (Partly done counts half).

The planned tasks live in the person's plan sheet (SheetEntry rows), as before; WeekPlan holds the states and decisions.
"""
from collections import Counter, defaultdict
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from accounts.services import photo_of
from core import audit

from . import calc, services
from .models import SLOTS, PlanTemplate, Sheet, SheetEntry, Task, TeamSettings, WeekPlan, slot_counts

S = WeekPlan.Status
SUBMITTED, APPROVED, REJECTED, PENDING, FLAGGED = "submitted", "approved", "rejected", "pending", "flagged"
HISTORY_WEEKS = 26


class PlanError(Exception):
    """The request doesn't make sense as asked (HTTP 400). The message says why."""


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


def pad(slots):
    return (list(slots or []) + [None] * SLOTS)[:SLOTS]


def trim(items, empty=None):
    items = list(items)
    while items and (items[-1] is None or items[-1] == empty):
        items.pop()
    return items


def _first(qs):
    return qs.order_by("position", "id").first()


def _who(user):
    return (user.name or user.email) if user else None


def _d(day):
    return f"{day:%a} {day.day} {day:%b}"


def person_of(sheet):
    return sheet.person or (sheet.owner.name if sheet.owner else sheet.name.replace("Planning - ", ""))


def work_of_user(user):
    return _first(Sheet.objects.filter(owner=user, kind=Sheet.Kind.WORK, archived=False))


def plan_sheet_for(work, create=False, plans=None):
    """The plan sheet that goes with a work log (the same person). Made on first use, with the work log's job role, so its
    tasks are the ones the person can pick. plans: all plan sheets, when the caller looks up many people."""
    pool = plans if plans is not None else list(Sheet.objects.filter(kind=Sheet.Kind.PLAN, archived=False).order_by("position", "id"))
    if work.owner_id:
        match = [s for s in pool if s.owner_id == work.owner_id]
    elif work.person:
        match = [s for s in pool if s.owner_id is None and s.person.lower() == work.person.lower()]
    else:
        match = [s for s in pool if s.owner_id is None and s.name == f"Planning - {work.name}"[:80]]
    if match or not create:
        return match[0] if match else None
    return Sheet.objects.create(name=f"Planning - {work.name}"[:80], kind=Sheet.Kind.PLAN, owner=work.owner, person=work.person,
                                role=work.role, position=work.position, start_date=work.start_date)


def may_plan(user, work):
    """The person themselves, or an admin. Management only reads."""
    return user.is_team_admin or (user.does_own_work and work.owner_id == user.pk)


def week_of(day, cfg):
    ws = calc.week_start_of(day, cfg)
    return ws, ws + timedelta(days=6)


# ---------- the cut-off (FR-P6) ----------

def previous_working_day(day, cfg):
    d = day - timedelta(days=1)
    for _ in range(7):
        if calc.dow(d) not in cfg.weekend_days:
            return d
        d -= timedelta(days=1)
    return day - timedelta(days=1)


def plan_closed(day, st=None):
    """None while a day's plan can still be made and submitted, otherwise why not."""
    st = st or TeamSettings.load()
    t = services.today(st)
    if st.plan_cutoff == TeamSettings.Cutoff.SAME_DAY:
        return None if day >= t else "This day is over, so its plan is closed. Work done that day counts as unplanned hours."
    last = previous_working_day(day, services.cfg_of(st))
    if t <= last:
        return None
    return f"Plans for {_d(day)} had to be in by the end of {_d(last)}. You can still log the work you do that day; it counts as unplanned hours."


# ---------- plan states ----------

def states_of(p, day):
    return pad((p.slot_states or {}).get(day.isoformat()) if p else None)


def recompute(p, entries):
    """The week's status from its planned hours (entries: the plan sheet's days of that week)."""
    have = []
    for e in entries:
        states = states_of(p, e.day)
        have += [states[i] for i, s in enumerate(pad(e.slots)) if s is not None]
    if SUBMITTED in have:
        p.status = S.SUBMITTED
    elif have and all(x == APPROVED for x in have):
        p.status = S.APPROVED
    elif APPROVED in have:
        p.status = S.PARTIAL
    elif have and all(x == REJECTED for x in have):
        p.status = S.REJECTED
    else:
        p.status = S.DRAFT


def _week_entries(plan_sheet, ws):
    return list(plan_sheet.entries.filter(day__range=(ws, ws + timedelta(days=6))))


def guard_plan_change(user, plan_sheet, day, old, new):
    """Called when a plan day is saved: submitted and approved hours can't be changed by the person (an admin may); a
    changed rejected hour, or a cleared hour, becomes a draft again."""
    ws, _ = week_of(day, services.cfg_of(TeamSettings.load()))
    p = WeekPlan.objects.select_for_update().filter(sheet=plan_sheet, week_start=ws).first()
    if p is None:
        return
    states, old, new = states_of(p, day), pad(old), pad(new)
    changed = [i for i in range(SLOTS) if old[i] != new[i]]
    if not changed:
        return
    for i in changed:
        if states[i] in (SUBMITTED, APPROVED) and not user.is_team_admin:
            raise services.Locked(f"Hour {i + 1} is {'waiting for approval' if states[i] == SUBMITTED else 'approved'}, so it can't be changed. "
                                  + ("Withdraw the plan to change it." if states[i] == SUBMITTED else "Ask your supervisor if it must change."))
        if states[i] == REJECTED or new[i] is None:
            states[i] = None
    p.slot_states = {**(p.slot_states or {}), day.isoformat(): trim(states)}
    recompute(p, [e for e in _week_entries(plan_sheet, ws) if e.day != day] + [SheetEntry(day=day, slots=new)])
    p.save(update_fields=["slot_states", "status", "updated_at"])


def approved_plans(work, frm, to, cfg):
    """{day: the approved task of each hour (None where nothing is approved)} for the days from frm to to."""
    plan_sheet = plan_sheet_for(work)
    if plan_sheet is None:
        return {}
    plans = {p.week_start: p for p in WeekPlan.objects.filter(sheet=plan_sheet, week_start__range=(calc.week_start_of(frm, cfg), to))}
    out = {}
    for e in plan_sheet.entries.filter(day__range=(frm, to)):
        p = plans.get(calc.week_start_of(e.day, cfg))
        if p:
            states = states_of(p, e.day)
            approved = [s if states[i] == APPROVED else None for i, s in enumerate(pad(e.slots))]
            if any(approved):
                out[e.day] = approved
    return out


def adherence(approved, entry):
    """(ratio or None, completed, approved hours): approved hours done as planned; Partly done counts half."""
    hours = [i for i, p in enumerate(approved or []) if p is not None]
    if not hours:
        return None, 0, 0
    slots = pad(entry.slots if entry else [])
    done = 0.0
    for i in hours:
        m = entry.meta_at(i) if entry else {}
        if slots[i] == approved[i] and slot_counts(slots[i], m):
            done += 0.5 if m.get("status") == "partly" else 1
    return done / len(hours), done, len(hours)


# ---------- the hour log (FR-T1–T3, §6) ----------

def log_details(user, work, day, slots, sent, entry, st):
    """Compare a work-log day with the approved plan and work out each hour's details. Returns (slots, details).
    sent: the details from the screen, one per hour (None when an older screen sends none)."""
    planned = approved_plans(work, day, day, services.cfg_of(st)).get(day, [None] * SLOTS)
    new, old = pad(slots), pad(entry.slots if entry else [])
    old_meta = [entry.meta_at(i) if entry else {} for i in range(SLOTS)]
    names = None
    out = []
    for i in range(SLOTS):
        s, p, was, wm = new[i], planned[i], old[i], old_meta[i]
        if sent is None:
            m_in = wm if s == was else {}
        else:
            m_in = (sent[i] if i < len(sent) else None) or {}
        reason = (m_in.get("reason") or "").strip()
        if m_in.get("status") == "not_done":
            new[i] = None
            if p is None:                          # nothing was planned in this hour: just leave it empty
                out.append({})
                continue
            if not reason:
                raise services.Locked(f"Hour {i + 1}: say why the planned task wasn't done.")
            out.append({"status": "not_done", "reason": reason[:300], "planned": p})
            continue
        if s is None:
            out.append({})
            continue
        m = {"status": "partly" if m_in.get("status") == "partly" else "done", "planned": p}
        if m_in.get("qty") is not None:
            m["qty"] = int(m_in["qty"])
        if m_in.get("ref"):
            m["ref"] = str(m_in["ref"]).strip()[:200]
        task_id = m_in.get("task") or (wm.get("task") if s == was else None)
        if task_id:                                # logged from My Tasks (FR-MT5)
            from mytasks.services import assigned_review
            m["task"] = int(task_id)
            if (s == was and wm.get("assigned")) or assigned_review(work, int(task_id), s):
                m.update(assigned=True, review=APPROVED, **({"unplanned": True} if p is None else {}))   # assigned: pre-approved (FR-MT4)
                out.append(m)
                continue
        if p is not None and s != p:               # a deviation
            if not reason:
                names = names or dict(Task.objects.values_list("id", "name"))
                raise services.Locked(f'Hour {i + 1}: the approved plan says "{names.get(p, "another task")}". Say why you did something else.')
            m["reason"] = reason[:300]
            m["review"] = wm.get("review") if s == was and wm.get("review") in (APPROVED, REJECTED) else PENDING
        elif p is None:                            # unplanned (D1)
            m["unplanned"] = True
            if reason:
                m["reason"] = reason[:300]
            if s == was and was is not None:       # unchanged: keeps its state (a later switch to strict mode isn't retroactive)
                if wm.get("review"):
                    m["review"] = wm["review"]
            elif st.unplanned_mode == TeamSettings.Unplanned.STRICT:
                m["review"] = PENDING
        elif s == was and wm.get("review") == FLAGGED:
            m["review"] = FLAGGED                  # a flag stays until a supervisor removes it
        out.append(m)
    return trim(new), trim(out, {})


# ---------- one week of a person's plan ----------

def week(user, work, day):
    st = TeamSettings.load()
    cfg, t = services.cfg_of(st), services.today(st)
    ws, we = week_of(day, cfg)
    can_plan = may_plan(user, work)
    plan_sheet = plan_sheet_for(work, create=can_plan)
    p = WeekPlan.objects.filter(sheet=plan_sheet, week_start=ws).select_related("submitted_by", "reviewed_by").first() if plan_sheet else None
    pts = {x.id: float(x.points) for x in Task.objects.all()}
    planned = {e.day: e for e in plan_sheet.entries.filter(day__range=(ws - timedelta(days=7), we))} if plan_sheet else {}
    done = {e.day: e for e in work.entries.filter(day__range=(ws, we))}
    days, counts = [], Counter()
    for k in range(7):
        d = ws + timedelta(days=k)
        e, w = planned.get(d), done.get(d)
        slots, states = pad(e.slots if e else []), states_of(p, d)
        cell_states = [states[i] if slots[i] is not None else None for i in range(SLOTS)]
        for i, s in enumerate(slots):
            if s is not None:
                counts[cell_states[i] or "draft"] += 1
        block = services.entry_block(user, plan_sheet, d, st) if plan_sheet else "Only the person or an admin can plan this week."
        approved = [s if cell_states[i] == APPROVED else None for i, s in enumerate(slots)]
        ratio, _, approved_hours = adherence(approved, w)
        days.append({
            "day": d, "slots": slots, "states": cell_states, "note": e.remarks if e else "",
            "hours": calc.day_hours(slots), "points": calc.day_points(slots, pts), "weekend": calc.dow(d) in cfg.weekend_days,
            "editable": block is None, "blocked": block, "approved_hours": approved_hours,
            "done": {"logged": calc.day_hours(w.slots), "hours": calc.day_hours(w.counted_slots()), "points": calc.day_points(w.counted_slots(), pts),
                     "adherence": ratio} if w else None,
        })
    open_ = [x for x in days if x["editable"]]
    submittable = sum(1 for x in open_ for i, s in enumerate(x["slots"]) if s is not None and x["states"][i] in (None, REJECTED))
    status = p.status if p else (S.DRAFT if counts else None)
    phase = "closed" if we < t else "execution" if ws <= t and status in (S.APPROVED, S.PARTIAL) else None
    return {
        "work": work.id, "plan_sheet": plan_sheet.id if plan_sheet else None, "person": person_of(work), "photo": photo_of(work.owner),
        "role": work.role.name if work.role else None, "mine": work.owner_id == user.pk, "today": t,
        "week": {"start": ws, "end": we, "no": calc.week_no(ws, cfg)[0], "current": ws <= t <= we, "past": we < t},
        "status": status, "status_label": S(status).label if status else "Not planned", "phase": phase,
        "plan": {"goals": p.goals, "submitted_at": p.submitted_at, "submitted_by": _who(p.submitted_by), "reviewed_at": p.reviewed_at,
                 "reviewed_by": _who(p.reviewed_by), "review_note": p.review_note} if p else None,
        "days": days, "counts": {"draft": counts["draft"], "submitted": counts[SUBMITTED], "approved": counts[APPROVED], "rejected": counts[REJECTED]},
        "totals": {"hours": sum(x["hours"] for x in days), "points": calc.r2(sum(x["points"] for x in days)), "approved": counts[APPROVED],
                   "logged": sum(x["done"]["logged"] for x in days if x["done"]), "output": sum(x["done"]["hours"] for x in days if x["done"])},
        "submittable": submittable, "target_hours": float(work.target_hours), "cutoff": st.plan_cutoff,
        "choices": list(work.role.tasks.filter(active=True).values_list("id", flat=True)) if work.role else [],
        "can": {"plan": can_plan and bool(plan_sheet), "submit": can_plan and submittable > 0, "withdraw": can_plan and counts[SUBMITTED] > 0,
                "copy_last_week": can_plan and any(calc.filled(x.slots) for d, x in planned.items() if d < ws), "templates": can_plan},
    }


@transaction.atomic
def act(user, work, day, action, goals=None):
    """submit: send every draft or rejected hour on days still open; withdraw: take back the hours waiting for approval."""
    if not may_plan(user, work):
        raise NotAllowed("Only the person or an admin can change this plan.")
    st = TeamSettings.load()
    plan_sheet = plan_sheet_for(work, create=True)
    ws, _ = week_of(day, services.cfg_of(st))
    p, _ = WeekPlan.objects.select_for_update().get_or_create(sheet=plan_sheet, week_start=ws)
    entries = _week_entries(plan_sheet, ws)
    n = 0
    for e in entries:
        if action == "submit" and not user.is_team_admin and plan_closed(e.day, st):
            continue
        states = states_of(p, e.day)
        for i, s in enumerate(pad(e.slots)):
            if s is None:
                continue
            if action == "submit" and states[i] in (None, REJECTED):
                states[i], n = SUBMITTED, n + 1
            elif action == "withdraw" and states[i] == SUBMITTED:
                states[i], n = None, n + 1
        p.slot_states = {**(p.slot_states or {}), e.day.isoformat(): trim(states)}
    if action == "submit":
        if not n:
            raise PlanError("There's nothing new to submit. Plan some hours on days that are still open first.")
        if goals is not None:
            p.goals = goals.strip()[:1000]
        p.submitted_at, p.submitted_by = timezone.now(), user
    elif action == "withdraw":
        if not n:
            raise PlanError("Nothing is waiting for approval.")
    else:
        raise PlanError("Unknown action.")
    recompute(p, entries)
    p.save()
    audit.log(user, f"plan.{action}", plan_sheet, week=str(ws), person=person_of(work), hours=n)
    return n


@transaction.atomic
def save_goals(user, work, day, goals):
    if not may_plan(user, work):
        raise NotAllowed("Only the person or an admin can change this plan.")
    plan_sheet = plan_sheet_for(work, create=True)
    ws, _ = week_of(day, services.cfg_of(TeamSettings.load()))
    p, _ = WeekPlan.objects.get_or_create(sheet=plan_sheet, week_start=ws)
    p.goals = goals.strip()[:1000]
    p.save(update_fields=["goals", "updated_at"])


@transaction.atomic
def copy(user, work, day, source, from_day=None, template_id=None):
    """Fill this week's empty, open days: from the same weekday last week, from one day of this week, or from a template
    (FR-P4). Never overwrites a planned day; skips weekends."""
    if not may_plan(user, work):
        raise NotAllowed("Only the person or an admin can change this plan.")
    st = TeamSettings.load()
    cfg = services.cfg_of(st)
    plan_sheet = plan_sheet_for(work, create=True)
    ws, we = week_of(day, cfg)
    days = [ws + timedelta(days=k) for k in range(7)]
    have = {e.day: e for e in plan_sheet.entries.filter(day__range=(ws - timedelta(days=7), we))}
    if source == "last_week":
        pairs = [(d, have[d - timedelta(days=7)].slots) for d in days if d - timedelta(days=7) in have]
    elif source == "day":
        if from_day not in days or from_day not in have:
            raise PlanError("Copy from a planned day of this week.")
        pairs = [(d, have[from_day].slots) for d in days if d != from_day]
    elif source == "template":
        tpl = PlanTemplate.objects.filter(pk=template_id).first()
        if tpl is None:
            raise PlanError("That template doesn't exist any more.")
        pairs = [(d, tpl.days.get(str(k)) or []) for k, d in enumerate(days)]
    else:
        raise PlanError("Copy from last week, a day or a template.")
    filled = 0
    for d, slots in pairs:
        e = have.get(d)
        if not calc.filled(slots) or calc.dow(d) in cfg.weekend_days or (e and calc.filled(e.slots)):
            continue
        if services.entry_block(user, plan_sheet, d, st):
            continue
        try:
            services.save_entry(user, plan_sheet, d, slots, e.remarks if e else "")
            filled += 1
        except services.Locked:   # e.g. a task that's no longer one of the person's
            continue
    if filled:
        audit.log(user, "plan.copy", plan_sheet, week=str(ws), source=source, days=filled)
    return filled


# ---------- templates (FR-P4) ----------

def templates(user):
    return [{"id": x.id, "name": x.name, "hours": sum(calc.day_hours(v) for v in x.days.values())} for x in PlanTemplate.objects.filter(owner=user)]


@transaction.atomic
def save_template(user, work, day, name):
    if not may_plan(user, work):
        raise NotAllowed("Only the person or an admin can save this plan as a template.")
    name = " ".join(name.split())[:80]
    if not name:
        raise PlanError("Give the template a name.")
    plan_sheet = plan_sheet_for(work)
    ws, we = week_of(day, services.cfg_of(TeamSettings.load()))
    days = {str((e.day - ws).days): trim(e.slots) for e in plan_sheet.entries.filter(day__range=(ws, we)) if calc.filled(e.slots)} if plan_sheet else {}
    if not days:
        raise PlanError("Plan some hours this week first, then save them as a template.")
    PlanTemplate.objects.update_or_create(owner=user, name=name, defaults={"days": days})


def delete_template(user, pk):
    if not PlanTemplate.objects.filter(owner=user, pk=pk).delete()[0]:
        raise PlanError("That template doesn't exist any more.")


# ---------- the Team Board (FR-P5) and decisions ----------

def _team(plans_pool=None):
    works = list(Sheet.objects.filter(kind=Sheet.Kind.WORK, archived=False).select_related("owner__profile", "role").order_by("position", "id"))
    pool = list(Sheet.objects.filter(kind=Sheet.Kind.PLAN, archived=False).order_by("position", "id"))
    return works, {w.id: plan_sheet_for(w, plans=pool) for w in works}


def board(user, day):
    """Everyone's week for supervisors: planned hours with their state, logged hours with deviations and unplanned hours,
    what waits for a decision, and planned coverage by kind of work."""
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins see the Team Board.")
    st = TeamSettings.load()
    cfg, t = services.cfg_of(st), services.today(st)
    ws, we = week_of(day, cfg)
    days = [ws + timedelta(days=k) for k in range(7)]
    works, plan_of = _team()
    plan_ids = [s.id for s in plan_of.values() if s]
    plans = {p.sheet_id: p for p in WeekPlan.objects.filter(sheet_id__in=plan_ids, week_start=ws)}
    pentries, wentries = defaultdict(dict), defaultdict(dict)
    for e in SheetEntry.objects.filter(sheet_id__in=plan_ids, day__range=(ws, we)):
        pentries[e.sheet_id][e.day] = e
    for e in SheetEntry.objects.filter(sheet__in=works, day__range=(ws, we)):
        wentries[e.sheet_id][e.day] = e
    types = {x.id: x.type or "Other" for x in Task.objects.all()}
    members, coverage, totals = [], Counter(), Counter()
    for w in works:
        ps = plan_of[w.id]
        p = plans.get(ps.id) if ps else None
        pending, rows = Counter(), []
        for d in days:
            pe, le = pentries[ps.id].get(d) if ps else None, wentries[w.id].get(d)
            pslots, states, lslots = pad(pe.slots if pe else []), states_of(p, d), pad(le.slots if le else [])
            plan_cells = [{"task": s, "state": states[i] or "draft"} if s is not None else None for i, s in enumerate(pslots)]
            log_cells = []
            for i in range(SLOTS):
                m = le.meta_at(i) if le else {}
                log_cells.append({"task": lslots[i], "status": m.get("status") or ("done" if lslots[i] else None), "review": m.get("review"),
                                  "reason": m.get("reason", ""), "unplanned": bool(m.get("unplanned")), "planned": m.get("planned")}
                                 if lslots[i] is not None or m else None)
            for c in plan_cells:
                if c:
                    pending["plan"] += c["state"] == SUBMITTED
                    if c["state"] in (SUBMITTED, APPROVED):
                        coverage[types.get(c["task"], "Other")] += 1
            for c in log_cells:
                if c and c["review"] == PENDING:
                    pending["unplanned" if c["unplanned"] else "deviation"] += 1
            rows.append({"day": d, "plan": plan_cells, "log": log_cells})
        own = w.owner_id == user.pk
        if not own:
            totals.update(pending)
        members.append({
            "work": w.id, "person": person_of(w), "photo": photo_of(w.owner), "role": w.role.name if w.role else None, "own": own,
            "status": p.status if p else None, "status_label": p.get_status_display() if p else "Not planned", "goals": p.goals if p else "",
            "review_note": p.review_note if p else "", "target_hours": float(w.target_hours),
            "planned_hours": sum(1 for r in rows for c in r["plan"] if c), "approved_hours": sum(1 for r in rows for c in r["plan"] if c and c["state"] == APPROVED),
            "days": rows, "pending": {k: pending[k] for k in ("plan", "deviation", "unplanned")},
        })
    return {"week": {"start": ws, "end": we, "no": calc.week_no(ws, cfg)[0], "current": ws <= t <= we, "past": we < t}, "today": t,
            "members": members, "coverage": [{"type": k, "hours": v} for k, v in coverage.most_common()],
            "pending": {k: totals[k] for k in ("plan", "deviation", "unplanned")}, "unplanned_mode": st.unplanned_mode}


@transaction.atomic
def decide(user, items, decision, note="", task_id=None):
    """Decide many hours at once (bulk approval, D1). items: [{work, day, slot (0–9), kind: plan | log}].
    approve (optionally at another task: edit and approve) · reject (with a note) · flag / unflag (logged hours).
    Returns how many hours changed. Nobody decides on their own hours."""
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins approve plans and hours.")
    note = (note or "").strip()
    if decision == "reject" and len(note) < 3:
        raise PlanError("Say why, so the person knows what to change.")
    task = Task.objects.filter(pk=task_id).first() if task_id else None
    if task_id and task is None:
        raise PlanError("That task doesn't exist.")
    st = TeamSettings.load()
    cfg = services.cfg_of(st)
    works = {s.id: s for s in Sheet.objects.filter(pk__in={it["work"] for it in items}, kind=Sheet.Kind.WORK)}
    pool = list(Sheet.objects.filter(kind=Sheet.Kind.PLAN, archived=False).order_by("position", "id"))
    plans, changed = {}, Counter()
    for it in items:
        work = works.get(it["work"])
        if work is None:
            raise PlanError("One of the people chosen doesn't exist.")
        if work.owner_id == user.pk:
            raise NotAllowed("You can't decide on your own plan or hours; another supervisor does.")
        d, i, kind = it["day"], it["slot"], it["kind"]
        if kind == "plan":
            plan_sheet = plan_sheet_for(work, plans=pool)
            if plan_sheet is None:
                continue
            ws, _ = week_of(d, cfg)
            key = (plan_sheet.id, ws)
            if key not in plans:
                plans[key] = WeekPlan.objects.select_for_update().filter(sheet=plan_sheet, week_start=ws).first()
            p = plans[key]
            if p is None:
                continue
            states = states_of(p, d)
            if states[i] != SUBMITTED or decision not in ("approve", "reject"):
                continue
            if decision == "approve" and task:
                e, _ = SheetEntry.objects.select_for_update().get_or_create(sheet=plan_sheet, day=d)
                slots = pad(e.slots)
                slots[i] = task.id
                e.slots, e.updated_by = trim(slots), user
                e.save(update_fields=["slots", "updated_by", "updated_at"])
            states[i] = APPROVED if decision == "approve" else REJECTED
            p.slot_states = {**(p.slot_states or {}), d.isoformat(): trim(states)}
        else:
            e = SheetEntry.objects.select_for_update().filter(sheet=work, day=d).first()
            if e is None:
                continue
            slots, m = pad(e.slots), dict(e.meta_at(i))
            if slots[i] is None:
                continue
            review = m.get("review")
            if decision == "approve" and (review in (PENDING, REJECTED, FLAGGED) or task):
                if task:
                    slots[i] = task.id
                m["review"] = APPROVED
            elif decision == "reject" and review == PENDING:
                m["review"], m["note"] = REJECTED, note[:300]
            elif decision == "flag" and review not in (FLAGGED,):
                m["review"] = FLAGGED
                if note:
                    m["note"] = note[:300]
            elif decision == "unflag" and review == FLAGGED:
                m.pop("review")
            else:
                continue
            meta = [e.meta_at(k) for k in range(max(len(e.meta or []), i + 1))]
            meta[i] = m
            e.slots, e.meta = trim(slots), trim(meta, {})
            e.save(update_fields=["slots", "meta", "updated_at"])
        changed[(work.id, kind)] += 1
    now = timezone.now()
    for (sheet_id, ws), p in plans.items():
        if p is None:
            continue
        recompute(p, _week_entries(p.sheet, ws))
        p.reviewed_at, p.reviewed_by = now, user
        if note:
            p.review_note = note[:500]
        p.save()
    for (work_id, kind), n in changed.items():
        audit.log(user, f"review.{kind}.{decision}", works[work_id], flagged=(decision == "flag"), hours=n, person=person_of(works[work_id]),
                  **({"note": note[:200]} if note else {}), **({"task": task.name} if task else {}))
    return sum(changed.values())


# ---------- history and the bell ----------

def history(user, work):
    """Every planned or logged week of the last six months (and any planned ahead), newest first: planned, approved,
    logged and output hours, points, adherence and the decision."""
    st = TeamSettings.load()
    cfg, t = services.cfg_of(st), services.today(st)
    since = calc.week_start_of(t, cfg) - timedelta(weeks=HISTORY_WEEKS)
    pts = {x.id: float(x.points) for x in Task.objects.all()}
    plan_sheet = plan_sheet_for(work)
    plans = {p.week_start: p for p in WeekPlan.objects.filter(sheet=plan_sheet, week_start__gte=since).select_related("reviewed_by")} if plan_sheet else {}
    planned = {e.day: e for e in plan_sheet.entries.filter(day__gte=since)} if plan_sheet else {}
    done = {e.day: e for e in work.entries.filter(day__gte=since)}
    weeks = defaultdict(lambda: Counter())
    for d, e in planned.items():
        ws = calc.week_start_of(d, cfg)
        states = states_of(plans.get(ws), d)
        approved = [s if states[i] == APPROVED else None for i, s in enumerate(pad(e.slots))]
        w = weeks[ws]
        w["planned"] += calc.day_hours(e.slots)
        _, completed, n = adherence(approved, done.get(d))
        w["approved"] += n
        w["completed"] += completed
    for d, e in done.items():
        w = weeks[calc.week_start_of(d, cfg)]
        w["logged"] += calc.day_hours(e.slots)
        w["output"] += calc.day_hours(e.counted_slots())
        w["points"] += calc.day_points(e.counted_slots(), pts)
        w["pending"] += sum(1 for k in range(SLOTS) if e.meta_at(k).get("review") == PENDING)
    rows = []
    for ws in sorted(set(weeks) | set(plans), reverse=True):
        w, p, we = weeks[ws], plans.get(ws), ws + timedelta(days=6)
        rows.append({
            "week_start": ws, "week_end": we, "week_no": calc.week_no(ws, cfg)[0],
            "status": p.status if p else None, "status_label": p.get_status_display() if p else "Not planned",
            "when": "past" if we < t else "current" if ws <= t else "ahead",
            "planned_hours": w["planned"], "approved_hours": w["approved"], "logged_hours": w["logged"], "output_hours": w["output"],
            "points": calc.r2(w["points"]), "pending": w["pending"],
            "adherence": w["completed"] / w["approved"] if w["approved"] and ws <= t else None,
            "reviewed_by": _who(p.reviewed_by) if p else None, "reviewed_at": p.reviewed_at if p else None,
        })
    return {"weeks": rows, "target_hours": float(work.target_hours)}


def mine(user):
    """For the bell: hours waiting for this person's decision (supervisors), and the state of their own plan this week and
    next week (rejected hours to fix; next week due from the second-last day of the week)."""
    st = TeamSettings.load()
    cfg, t = services.cfg_of(st), services.today(st)
    ws, _ = week_of(t, cfg)
    nxt = ws + timedelta(days=7)
    out = {"can_plan": user.does_own_work and work_of_user(user) is not None, "can_approve": user.can_approve,
           "to_review": None, "this_week": None, "next_week": None}
    if user.can_approve:
        waiting = 0
        for states in WeekPlan.objects.filter(status=S.SUBMITTED, week_start__gte=ws - timedelta(days=7)).exclude(sheet__owner=user).values_list("slot_states", flat=True):
            waiting += sum(1 for v in (states or {}).values() for x in v if x == SUBMITTED)
        for meta in (SheetEntry.objects.filter(sheet__kind=Sheet.Kind.WORK, day__gte=t - timedelta(days=60), meta__contains=[{"review": PENDING}])
                     .exclude(sheet__owner=user).values_list("meta", flat=True)):
            waiting += sum(1 for m in meta if m and m.get("review") == PENDING)
        out["to_review"] = waiting
    if out["can_plan"]:
        plan_sheet = plan_sheet_for(work_of_user(user))
        found = {p.week_start: p for p in WeekPlan.objects.filter(sheet=plan_sheet, week_start__in=[ws, nxt])} if plan_sheet else {}
        for key, w0 in (("this_week", ws), ("next_week", nxt)):
            p = found.get(w0)
            out[key] = {"start": w0, "status": p.status if p else None,
                        "rejected": sum(1 for v in (p.slot_states or {}).values() for x in v if x == REJECTED) if p else 0}
        out["next_week"]["due"] = (t - ws).days >= 5
    return out
