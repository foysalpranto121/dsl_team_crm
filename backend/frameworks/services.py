"""Stage Framework rules (SRS v0.5 §5.7, D6). Plain functions, called by the views and by tracker.pipeline.move:

- the team calendar: steps fall on working days, skipping the weekend and holidays (FR-C2, FR-SF5);
- generation: a record entering a stage gets its default framework's dated steps (FR-SF4, FR-SF5);
- completing a step asks for an outcome, writes the Client Log (FR-SF8) and applies the outcome rule or stop condition (FR-SF3);
- stage changes close the old framework's unfinished steps, kept or dropped as the member chose; drops are logged (FR-SF5, FR-DP7);
- load handling: overdue items over the threshold flag a member Overloaded; their new steps wait until it clears (FR-SF6, D6);
- versioning: edits affect new records only, unless a supervisor applies them to open records after a preview (FR-SF7).
"""
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from accounts.models import User
from core import audit
from team import calc
from team import services as team
from team.models import TeamSettings
from tracker.models import ClientLogEntry, PipelineStage, Prospect

from .models import (Framework, FrameworkAssignment, FrameworkStep, FrameworkVersion, OutcomeRule, OverloadFlag, StepInstance, StepType,
                     default_outcomes)

S = StepInstance.Status
WAITING = (S.OPEN, S.HELD)                       # not finished yet
LOG_TYPE = {StepType.CALL: ClientLogEntry.Type.CALL, StepType.EMAIL: ClientLogEntry.Type.EMAIL, StepType.WHATSAPP: ClientLogEntry.Type.WHATSAPP,
            StepType.VISIT: ClientLogEntry.Type.VISIT, StepType.DEMO: ClientLogEntry.Type.MEETING}


class FrameworkError(Exception):
    """The request doesn't make sense as asked (HTTP 400). `code` lets the screen react (e.g. ask for a next action)."""

    def __init__(self, message, code=""):
        super().__init__(message)
        self.code = code


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


def new_key():
    return secrets.token_hex(4)


def today(st=None):
    return team.today(st)


def person(u):
    return (u.name or u.email) if u else ""


# ---------- the team calendar (FR-C2, FR-SF5) ----------

class Calendar:
    """Working days: not a weekend day, not a holiday."""

    def __init__(self, st=None):
        st = st or TeamSettings.load()
        self.weekend = frozenset(st.weekend_days or [])
        self.holidays = frozenset(st.holidays or [])

    def working(self, d):
        return calc.dow(d) not in self.weekend and d.isoformat() not in self.holidays

    def first(self, d):
        """d, or the next working day after it."""
        for _ in range(800):
            if self.working(d):
                return d
            d += timedelta(days=1)
        return d

    def add(self, d, n):
        """n working days after d (0 = d itself, or the next working day when d isn't one)."""
        d = self.first(d)
        for _ in range(n):
            d = self.first(d + timedelta(days=1))
        return d

    def between(self, a, b):
        """Working days after a, up to and including b (0 when b <= a)."""
        n, d = 0, a + timedelta(days=1)
        while d <= b:
            n += self.working(d)
            d += timedelta(days=1)
        return n


# ---------- frameworks, versions, defaults (FR-SF1, FR-SF4, FR-SF7) ----------

def snapshot(fw):
    return {
        "name": fw.name, "description": fw.description, "stage": fw.stage.key, "segment": fw.segment, "outcomes": list(fw.outcomes or []),
        "steps": [{"key": s.key, "position": s.position, "title": s.title, "day_offset": s.day_offset, "type": s.type, "activity": s.activity_id,
                   "resource_url": s.resource_url, "instruction": s.instruction, "stop_on": list(s.stop_on or [])} for s in fw.steps.all()],
        "rules": [{"outcome": r.outcome, "step_key": r.step_key, "action": r.action, "retry_days": r.retry_days, "retry_max": r.retry_max,
                   "jump_key": r.jump_key} for r in fw.rules.all()],
    }


def save_version(fw, by):
    FrameworkVersion.objects.update_or_create(framework=fw, number=fw.version, defaults={"data": snapshot(fw), "created_by": by})


def version_data(a):
    v = FrameworkVersion.objects.filter(framework_id=a.framework_id, number=a.version).first()
    return v.data if v else snapshot(a.framework)


def _seg(v):
    return " ".join((v or "").split()).lower()


def matches(fw, segment):
    return not fw.segment.strip() or _seg(fw.segment) == _seg(segment)


def default_for(stage_key, segment=""):
    """The stage's default framework for this segment, else its default for every segment (FR-SF4)."""
    general = None
    for f in Framework.objects.filter(stage__key=stage_key, active=True, is_default=True).order_by("id"):
        if f.segment.strip() and _seg(f.segment) == _seg(segment):
            return f
        if not f.segment.strip() and general is None:
            general = f
    return general


def choices_for(record):
    """The active frameworks a member may pick for this record: its stage, its segment or every segment (FR-SF4)."""
    return [f for f in Framework.objects.filter(stage__key=record.stage, active=True).prefetch_related("steps") if matches(f, record.segment)]


def covers(stage_key, segment=""):
    """Entering this stage gives the record dated steps, so it has a next step without one being typed (FR-CL3)."""
    f = default_for(stage_key, segment)
    return bool(f and f.steps.exists())


@transaction.atomic
def make_default(user, fw):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins choose the default framework.")
    if not fw.active:
        raise FrameworkError("Switch the framework on before making it the default.")
    if not fw.steps.exists():
        raise FrameworkError("Add at least one step first.")
    for other in Framework.objects.filter(stage=fw.stage, is_default=True).exclude(pk=fw.pk):
        if _seg(other.segment) == _seg(fw.segment):
            other.is_default = False
            other.save(update_fields=["is_default", "updated_at"])
    fw.is_default = True
    fw.save(update_fields=["is_default", "updated_at"])
    audit.log(user, "framework.default", fw.name, stage=fw.stage.name, segment=fw.segment)
    return fw


# ---------- generating steps (FR-SF5) ----------

def held(owner_id):
    """New steps for this member wait in a queue: they are flagged Overloaded and no supervisor overrode it (FR-SF6)."""
    return OverloadFlag.objects.filter(owner_id=owner_id, cleared_at__isnull=True, overridden_at__isnull=True).exists()


def _instance(a, record, s, due, hold, t, attempt=1):
    g = s.get if isinstance(s, dict) else (lambda k, d=None: getattr(s, k + ("_id" if k == "activity" else ""), d))
    return StepInstance(assignment=a, record=record, owner_id=record.owner_id, step_key=g("key"), position=g("position") or 0, attempt=attempt,
                        title=g("title"), type=g("type"), day_offset=g("day_offset") or 0, activity_id=g("activity"),
                        resource_url=g("resource_url") or "", instruction=g("instruction") or "", stop_on=list(g("stop_on") or []),
                        due_date=due, status=S.HELD if hold else S.OPEN, held_since=t if hold else None)


@transaction.atomic
def generate(record, stage_key, by, on=None, framework=None, chosen=False, st=None):
    """Start a framework on the record: its steps, dated from `on` on the team's working days. None when the stage has none."""
    fw = framework or default_for(stage_key, record.segment)
    if fw is None:
        return None
    st = st or TeamSettings.load()
    cal, t = Calendar(st), today(st)
    on = on or t
    if not FrameworkVersion.objects.filter(framework=fw, number=fw.version).exists():
        save_version(fw, by)
    a = FrameworkAssignment.objects.create(record=record, framework=fw, version=fw.version, stage=stage_key, started_on=on, chosen=chosen,
                                           by=by if getattr(by, "pk", None) else None)
    check(record.owner_id, st)                   # the flag follows today's overdue items before new steps are forwarded
    hold = held(record.owner_id)
    StepInstance.objects.bulk_create([_instance(a, record, s, cal.add(on, s.day_offset), hold, t) for s in fw.steps.all()])
    sync_next(record)
    return a


def close(record, how, on, reason, by):
    """Close the record's running framework. Its unfinished steps are kept on the member's list, or dropped and logged."""
    for a in FrameworkAssignment.objects.filter(record=record, active=True):
        a.active, a.closed_on, a.closed_reason = False, on, reason[:200]
        a.save(update_fields=["active", "closed_on", "closed_reason"])
        left = list(a.steps.filter(status__in=WAITING))
        if how == "drop" and left:
            StepInstance.objects.filter(pk__in=[s.pk for s in left]).update(status=S.DROPPED, reason=reason[:300], updated_at=timezone.now())
            titles = ", ".join(s.title for s in left)
            ClientLogEntry.objects.create(record=record, type=ClientLogEntry.Type.NOTE, day=on, by=by if getattr(by, "pk", None) else None,
                                          note=f"Framework steps dropped ({reason}): {titles}"[:1000])
            audit.log(by, "framework.drop_steps", record.company, record=record.id, framework=a.framework.name, steps=len(left), reason=reason)


def on_stage_change(record, to_key, by, on, old_steps="keep", baseline=False):
    """Called by tracker.pipeline.move after a record entered a stage. An imported record (baseline) gets no steps."""
    stage = PipelineStage.objects.filter(key=to_key).first()
    close(record, old_steps if old_steps in ("keep", "drop") else "keep", on, f"Stage changed to {stage.name if stage else to_key}", by)
    if not baseline:
        generate(record, to_key, by, on)
    sync_next(record)


@transaction.atomic
def pick(user, record, fw, old_steps="keep"):
    """FR-SF4: a member picks another approved framework for one record."""
    if record.owner_id != user.pk:
        raise NotAllowed("Only the record's owner picks its framework.")
    if not fw.active or fw.stage.key != record.stage or not matches(fw, record.segment):
        raise FrameworkError("Pick one of the active frameworks for this record's stage.")
    t = today()
    close(record, old_steps, t, f"Switched to {fw.name}", user)
    a = generate(record, record.stage, user, t, framework=fw, chosen=True)
    check(record.owner_id)
    return a


def sync_next(record):
    """The record's next step is its earliest unfinished framework step, when it has one (FR-CL3)."""
    nxt = StepInstance.objects.filter(record=record, status__in=WAITING).order_by("due_date", "position", "attempt", "id").first()
    if nxt and (record.next_follow_up != nxt.due_date or record.next_action != nxt.title[:200]):
        record.next_follow_up, record.next_action = nxt.due_date, nxt.title[:200]
        record.save(update_fields=["next_follow_up", "next_action", "updated_at"])
    return nxt


# ---------- doing the steps (FR-SF3, FR-SF8, FR-DP7) ----------

def _own(user, inst):
    if inst.owner_id != user.pk:
        raise NotAllowed("This step belongs to someone else.")


def _canon(outcome, allowed):
    o = " ".join((outcome or "").split())
    for a in allowed:
        if a.lower() == o.lower():
            return a
    raise FrameworkError("Choose one of the outcomes: " + ", ".join(allowed) + ".")


def _rule(data, outcome, step_key):
    rules = [r for r in data.get("rules") or [] if r["outcome"].lower() == outcome.lower()]
    return next((r for r in rules if r.get("step_key") == step_key), None) or next((r for r in rules if not r.get("step_key")), None)


def _next_or_require(record, exclude_ids, next_date, next_action):
    """FR-CL3: an open record always has a next framework step or a dated next action."""
    nxt = StepInstance.objects.filter(record=record, status__in=WAITING).exclude(pk__in=exclude_ids).order_by("due_date", "position", "attempt", "id").first()
    stage = PipelineStage.objects.filter(key=record.stage).first()
    if nxt is None and stage is not None and stage.kind == PipelineStage.Kind.OPEN:
        if not next_date or not (next_action or "").strip():
            raise FrameworkError("That was the last step for this record. Say what you'll do next and when, or move the record on.", "next_required")
        if next_date < today():
            raise FrameworkError("The next date can't be in the past.", "next_required")
    return nxt


def _finish_assignment(a, t, reason):
    if a.active and not a.steps.filter(status__in=WAITING).exists():
        a.active, a.closed_on, a.closed_reason = False, t, reason
        a.save(update_fields=["active", "closed_on", "closed_reason"])


@transaction.atomic
def complete(user, inst, outcome, note="", next_date=None, next_action=""):
    """Done, with an outcome. Writes the Client Log, then applies the stop condition or the outcome rule (retry in N working
    days up to M times, jump to a later step, or flag the record for stage review). Returns (step, what happened, free hour)."""
    from tracker import pipeline
    _own(user, inst)
    if inst.status == S.HELD:
        raise FrameworkError("This step is waiting until your overdue items are back under the limit.")
    if inst.status != S.OPEN:
        raise FrameworkError("This step isn't open.")
    a, record = inst.assignment, inst.record
    data = version_data(a)
    outcome = _canon(outcome, data.get("outcomes") or default_outcomes())
    st = TeamSettings.load()
    cal, t = Calendar(st), today(st)
    inst.status, inst.outcome, inst.note, inst.done_at, inst.done_by = S.DONE, outcome, (note or "").strip()[:1000], timezone.now(), user
    inst.save()
    result = {"action": "next", "label": ""}
    later = a.steps.filter(status__in=WAITING, position__gt=inst.position).order_by("position", "attempt")
    if outcome.lower() in {x.lower() for x in inst.stop_on or []}:
        n = a.steps.filter(status__in=WAITING).update(status=S.SKIPPED, reason=f"Stopped: {outcome}", updated_at=timezone.now())
        a.active, a.closed_on, a.closed_reason = False, t, f"Stopped: {outcome}"
        a.save(update_fields=["active", "closed_on", "closed_reason"])
        result = {"action": "stop", "label": f"“{outcome}” ends this framework" + (f"; {n} later {'step' if n == 1 else 'steps'} skipped." if n else ".")}
    elif rule := _rule(data, outcome, inst.step_key):
        if rule["action"] == OutcomeRule.Action.RETRY:
            if inst.attempt <= rule["retry_max"]:
                due = cal.add(t, rule["retry_days"])
                retry = _instance(a, record, {"key": inst.step_key, "position": inst.position, "title": inst.title, "type": inst.type,
                                              "day_offset": inst.day_offset, "activity": inst.activity_id, "resource_url": inst.resource_url,
                                              "instruction": inst.instruction, "stop_on": inst.stop_on}, due, held(record.owner_id), t, inst.attempt + 1)
                retry.save()
                result = {"action": "retry", "label": f"Trying again on {due.day} {due:%b} (try {inst.attempt + 1} of {rule['retry_max'] + 1})."}
            else:
                result = {"action": "next", "label": f"No more tries left ({rule['retry_max'] + 1} made); on to the next step."}
        elif rule["action"] == OutcomeRule.Action.JUMP:
            target = later.filter(step_key=rule["jump_key"]).first()
            if target:
                skipped = later.filter(position__lt=target.position)
                n = skipped.update(status=S.SKIPPED, reason=f"Jumped to {target.title}"[:300], updated_at=timezone.now())
                base = cal.add(t, 1)
                for s in a.steps.filter(status__in=WAITING, position__gte=target.position):
                    s.due_date = cal.add(base, max(0, s.day_offset - target.day_offset))
                    s.save(update_fields=["due_date", "updated_at"])
                result = {"action": "jump", "label": f"Jumped to “{target.title}”" + (f"; {n} {'step' if n == 1 else 'steps'} skipped." if n else ".")}
        elif rule["action"] == OutcomeRule.Action.FLAG:
            a.review_flag, a.review_note, a.reviewed_by, a.reviewed_at = True, f"{inst.title}: {outcome}" + (f" ({inst.note})" if inst.note else ""), None, None
            a.review_note = a.review_note[:300]
            a.save(update_fields=["review_flag", "review_note", "reviewed_by", "reviewed_at"])
            audit.log(user, "framework.flag_review", record.company, record=record.id, step=inst.title, outcome=outcome)
            result = {"action": "flag", "label": "Flagged for your supervisor to review the stage."}
    nxt = _next_or_require(record, [inst.pk], next_date, next_action)
    text = inst.title + (f": {inst.note}" if inst.note else "")
    e = pipeline.add_log(record, user, LOG_TYPE.get(inst.type, ClientLogEntry.Type.NOTE), outcome, text, t,
                         nxt.due_date if nxt else next_date, nxt.title if nxt else next_action)
    inst.log_entry = e
    inst.save(update_fields=["log_entry", "updated_at"])
    _finish_assignment(a, t, "All steps done")
    sync_next(record)
    check(record.owner_id, st)
    hour = None
    if inst.activity_id:
        from mytasks.services import free_hour
        hour = free_hour(user, t)
    return inst, result, hour


@transaction.atomic
def drop(user, inst, reason, next_date=None, next_action=""):
    """Drop a step with a reason. It never vanishes silently: the drop is in the Client Log and the audit log (FR-DP7)."""
    _own(user, inst)
    if inst.status not in WAITING:
        raise FrameworkError("This step isn't open.")
    reason = " ".join((reason or "").split())
    if len(reason) < 3:
        raise FrameworkError("Say why you're dropping it.")
    record, t = inst.record, today()
    nxt = _next_or_require(record, [inst.pk], next_date, next_action)
    inst.status, inst.reason = S.DROPPED, reason[:300]
    inst.save(update_fields=["status", "reason", "updated_at"])
    ClientLogEntry.objects.create(record=record, type=ClientLogEntry.Type.NOTE, day=t, by=user, note=f"Step dropped: {inst.title} ({reason})"[:1000],
                                  next_date=nxt.due_date if nxt else next_date)
    if nxt is None and next_date:
        record.next_follow_up, record.next_action = next_date, next_action.strip()[:200]
        record.save(update_fields=["next_follow_up", "next_action", "updated_at"])
    audit.log(user, "framework.drop_step", record.company, record=record.id, step=inst.title, reason=reason)
    _finish_assignment(inst.assignment, t, "All steps done")
    sync_next(record)
    check(record.owner_id)
    return inst


@transaction.atomic
def reschedule(user, inst, due):
    _own(user, inst)
    if inst.status != S.OPEN:
        raise FrameworkError("Only an open step can be moved.")
    if due < today():
        raise FrameworkError("Pick today or a later day.")
    inst.due_date = Calendar().first(due)
    inst.save(update_fields=["due_date", "updated_at"])
    sync_next(inst.record)
    check(inst.owner_id)
    return inst


@transaction.atomic
def log_hour(user, inst, hour):
    """FR-SF2: a step with an Activity Type, once done, can fill one empty hour of today's work log and earn its points.
    The hour follows the normal rules (an unplanned hour counts provisionally, D1)."""
    from mytasks.services import work_sheet
    from team.models import SLOTS, SheetEntry
    _own(user, inst)
    if inst.status != S.DONE or inst.activity_id is None:
        raise FrameworkError("Only a done step with an Activity Type can be logged as an hour.")
    if inst.logged_day:
        raise FrameworkError("This step is already logged.")
    work = work_sheet(user)
    if work is None:
        raise FrameworkError("You don't have a daily log yet.")
    t = today()
    e = SheetEntry.objects.filter(sheet=work, day=t).first()
    slots = ((list(e.slots) if e else []) + [None] * SLOTS)[:SLOTS]
    if not 0 <= hour < SLOTS or slots[hour] is not None:
        raise FrameworkError("Choose an empty hour.")
    slots[hour] = inst.activity_id
    meta = [(e.meta_at(i) if e else {}) for i in range(SLOTS)]
    meta[hour] = {"status": "done", "step": inst.id}
    keep = ("status", "qty", "ref", "reason", "task", "step")
    team.save_entry(user, work, t, slots, e.remarks if e else "", [{k: m.get(k) for k in keep if m.get(k) is not None} or None for m in meta])
    inst.logged_day, inst.logged_hour = t, hour
    inst.save(update_fields=["logged_day", "logged_hour", "updated_at"])
    return t, hour


# ---------- load handling (FR-SF6, D6) ----------

def overdue(owner_id, t, cal):
    """(open overdue items, working days the oldest has waited): framework steps and My Tasks past their date."""
    from mytasks.models import PersonalTask
    dates = list(StepInstance.objects.filter(owner_id=owner_id, status=S.OPEN, due_date__lt=t).values_list("due_date", flat=True))
    dates += list(PersonalTask.objects.filter(owner_id=owner_id, status=PersonalTask.Status.OPEN, due_date__lt=t).values_list("due_date", flat=True))
    return len(dates), (cal.between(min(dates), t) if dates else 0)


def release(owner_id, t=None, cal=None):
    """The member's waiting steps join their list, later by the working days they waited."""
    cal, t = cal or Calendar(), t or today()
    touched = set()
    for s in StepInstance.objects.filter(owner_id=owner_id, status=S.HELD):
        shift = cal.between(s.held_since or t, t)
        s.due_date = max(cal.add(s.due_date, shift), cal.first(t))
        s.status, s.held_since = S.OPEN, None
        s.save(update_fields=["due_date", "status", "held_since", "updated_at"])
        touched.add(s.record_id)
    for r in Prospect.objects.filter(pk__in=touched):
        sync_next(r)
    return len(touched)


def check(owner_id, st=None):
    """Raise or clear the member's Overloaded flag. Returns the open flag, or None."""
    st = st or TeamSettings.load()
    cal, t = Calendar(st), today(st)
    n, days = overdue(owner_id, t, cal)
    over = n > st.overload_items or days > st.overload_days
    flag = OverloadFlag.objects.filter(owner_id=owner_id, cleared_at__isnull=True).first()
    if over and flag is None:
        flag = OverloadFlag.objects.create(owner_id=owner_id, items=n, oldest_days=days)
        audit.log(None, "overload.raise", person(User.objects.filter(pk=owner_id).first()), items=n, oldest_days=days)
    elif not over and flag is not None:
        flag.cleared_at = timezone.now()
        flag.save(update_fields=["cleared_at"])
        audit.log(None, "overload.clear", person(flag.owner), items=n)
        release(owner_id, t, cal)
        flag = None
    return flag


def team_load(user):
    """Supervisors: each member's overdue items, waiting steps and Overloaded flag (checked now, as dates move every day)."""
    if not (user.can_approve or user.role == User.Role.VIEWER):
        raise NotAllowed("Only supervisors, management and admins see the team's load.")
    st = TeamSettings.load()
    cal, t = Calendar(st), today(st)
    people = User.objects.filter(status=User.Status.APPROVED, is_active=True, role__in=[User.Role.MEMBER, User.Role.SUPERVISOR]).order_by("name", "email")
    out = []
    for p in people:
        flag = check(p.pk, st)
        n, days = overdue(p.pk, t, cal)
        out.append({"id": p.pk, "name": person(p), "overdue": n, "oldest_days": days, "open_steps": StepInstance.objects.filter(owner=p, status=S.OPEN).count(),
                    "waiting": StepInstance.objects.filter(owner=p, status=S.HELD).count(),
                    "flag": {"id": flag.id, "raised_at": flag.raised_at, "overridden": bool(flag.overridden_at),
                             "overridden_by": person(flag.overridden_by), "note": flag.note} if flag else None})
    return {"today": t, "threshold_items": st.overload_items, "threshold_days": st.overload_days, "people": out}


@transaction.atomic
def override(user, flag, note=""):
    """A supervisor lets the member's new steps through while the flag is raised; it still clears by itself later."""
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins can override the flag.")
    if flag.owner_id == user.pk and not user.is_team_admin:
        raise NotAllowed("Someone else decides on your own flag.")
    if flag.cleared_at:
        raise FrameworkError("This flag has already cleared.")
    flag.overridden_by, flag.overridden_at, flag.note = user, timezone.now(), (note or "").strip()[:300]
    flag.save(update_fields=["overridden_by", "overridden_at", "note"])
    audit.log(user, "overload.override", person(flag.owner), note=flag.note)
    release(flag.owner_id)
    return flag


# ---------- stage review flags (FR-SF3) ----------

def stage_reviews():
    return [{"id": a.id, "record": a.record_id, "company": a.record.company, "person": person(a.record.owner), "owner": a.record.owner_id,
             "framework": a.framework.name, "note": a.review_note, "stage": a.stage}
            for a in FrameworkAssignment.objects.filter(review_flag=True, reviewed_at__isnull=True).select_related("record", "record__owner", "framework")[:200]]


@transaction.atomic
def review_stage(user, a, note=""):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins review pipeline changes.")
    if a.record.owner_id == user.pk and not user.is_team_admin:
        raise NotAllowed("Someone else reviews your own pipeline.")
    a.reviewed_by, a.reviewed_at = user, timezone.now()
    a.save(update_fields=["reviewed_by", "reviewed_at"])
    audit.log(user, "framework.review_stage", a.record.company, record=a.record_id, note=(note or "").strip()[:300])
    return a


# ---------- applying a new version to open records (FR-SF7) ----------

def _changes(fw, a, cal, t):
    new = {s.key: s for s in fw.steps.all()}
    rows, seen = [], set()
    for inst in a.steps.all():
        seen.add(inst.step_key)
        if inst.status not in WAITING:
            continue
        ns = new.get(inst.step_key)
        if ns is None:
            rows.append({"inst": inst, "step": None, "title": inst.title, "old": inst.due_date, "new": None, "change": "removed"})
            continue
        due = inst.due_date if inst.attempt > 1 else max(cal.add(a.started_on, ns.day_offset), cal.first(t))
        edited = (ns.title, ns.type, ns.activity_id, ns.instruction, ns.resource_url, list(ns.stop_on or [])) != \
                 (inst.title, inst.type, inst.activity_id, inst.instruction, inst.resource_url, list(inst.stop_on or []))
        change = "moved" if due != inst.due_date else "edited" if edited else ""
        if change:
            rows.append({"inst": inst, "step": ns, "title": ns.title, "old": inst.due_date, "new": due, "change": change})
    for key, ns in new.items():
        if key not in seen:
            rows.append({"inst": None, "step": ns, "title": ns.title, "old": None, "new": max(cal.add(a.started_on, ns.day_offset), cal.first(t)), "change": "added"})
    return rows


def preview(fw):
    """What applying the current version to the open records on older versions would change (FR-SF7)."""
    cal, t = Calendar(), today()
    out = []
    for a in fw.assignments.filter(active=True, version__lt=fw.version).select_related("record", "record__owner"):
        rows = _changes(fw, a, cal, t)
        out.append({"assignment": a.id, "record": a.record_id, "company": a.record.company, "person": person(a.record.owner), "version": a.version,
                    "changes": [{k: r[k] for k in ("title", "old", "new", "change")} for r in rows]})
    return {"version": fw.version, "records": out}


@transaction.atomic
def apply_to_open(user, fw):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins change frameworks.")
    cal, t = Calendar(), today()
    n = 0
    for a in fw.assignments.filter(active=True, version__lt=fw.version).select_related("record"):
        hold = held(a.record.owner_id)
        for r in _changes(fw, a, cal, t):
            inst, ns = r["inst"], r["step"]
            if r["change"] == "removed":
                inst.status, inst.reason = S.SKIPPED, f"Removed in version {fw.version}"
                inst.save(update_fields=["status", "reason", "updated_at"])
            elif r["change"] == "added":
                _instance(a, a.record, ns, r["new"], hold, t).save()
            else:
                inst.title, inst.type, inst.day_offset, inst.activity_id = ns.title, ns.type, ns.day_offset, ns.activity_id
                inst.instruction, inst.resource_url, inst.stop_on, inst.position, inst.due_date = ns.instruction, ns.resource_url, list(ns.stop_on or []), ns.position, r["new"]
                inst.save()
        a.version = fw.version
        a.save(update_fields=["version"])
        sync_next(a.record)
        n += 1
    audit.log(user, "framework.apply", fw.name, version=fw.version, records=n)
    return n


# ---------- the member's steps ----------

def summaries(owner_id):
    """{record id: {framework, open, waiting, next}} for one person's records, in two queries (the pipeline list)."""
    out = {}
    for a in FrameworkAssignment.objects.filter(record__owner_id=owner_id, active=True).select_related("framework"):
        out[a.record_id] = {"framework": a.framework.name, "framework_id": a.framework_id, "open": 0, "waiting": 0, "next": None, "flagged": a.review_flag and not a.reviewed_at}
    for s in StepInstance.objects.filter(owner_id=owner_id, status__in=WAITING).order_by("due_date", "position", "attempt", "id"):
        d = out.setdefault(s.record_id, {"framework": None, "framework_id": None, "open": 0, "waiting": 0, "next": None, "flagged": False})
        d["waiting" if s.status == S.HELD else "open"] += 1
        if d["next"] is None:
            d["next"] = {"id": s.id, "title": s.title, "type": s.type, "due_date": s.due_date, "status": s.status}
    return out


def replace_steps(fw, steps, rules):
    """Replace a framework's steps and rules (the studio saves the whole framework at once). A step keeps its key."""
    keys = set()
    fw.steps.all().delete()
    objs = []
    for i, s in enumerate(steps):
        key = s.get("key") or new_key()
        while key in keys:
            key = new_key()
        keys.add(key)
        act = s.get("activity")
        objs.append(FrameworkStep(framework=fw, key=key, position=i + 1, title=s["title"], day_offset=s["day_offset"], type=s["type"],
                                  activity_id=getattr(act, "pk", act), resource_url=s.get("resource_url") or "", instruction=s.get("instruction") or "",
                                  stop_on=s.get("stop_on") or []))
    FrameworkStep.objects.bulk_create(objs)
    fw.rules.all().delete()
    OutcomeRule.objects.bulk_create([OutcomeRule(framework=fw, **r) for r in rules])


VERSIONED = ("stage", "segment", "outcomes", "steps", "rules")


def changed(before, after):
    """A change to what records get makes a new version (FR-SF7); a new name or description doesn't."""
    return any(before[k] != after[k] for k in VERSIONED)
