"""The lightweight pipeline (SRS v0.5 §5.5, §5.9): the team's stages, moving a record between them, deal health, the Client
Log, and the supervisor's review of backward moves and wins. Every stage change is a StageEvent; the weekly KPIs are counted
from those events (tracker.kpis), so nobody types counters."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core import audit
from team import services as team_services

from .models import ClientLogEntry, KpiType, PipelineStage, Prospect, StageEvent

S = PipelineStage.Kind
STALE_CONTACT_DAYS = 14
# Stage keys from before SRS v0.5 (the personal tracker) and the stage each one became.
LEGACY = {"prospect": "lead", "contacted": "lead", "lead": "qualified", "opp": "requirements", "client": "won", "lost": "lost"}


class PipelineError(Exception):
    pass


def today():
    return team_services.today()


def stage_map(active_only=False):
    qs = PipelineStage.objects.all()
    return {s.key: s for s in (qs.filter(active=True) if active_only else qs)}


def first_stage():
    return PipelineStage.objects.filter(active=True, kind=S.OPEN).order_by("position", "id").first()


def resolve(key_or_name, stages=None):
    """A stage from its key, its name (any case) or a key from before v0.5; None if nothing matches."""
    stages = stages or stage_map(active_only=True)
    v = (key_or_name or "").strip()
    if v in stages:
        return stages[v]
    named = {s.name.lower(): s for s in stages.values()}
    return named.get(v.lower()) or stages.get(LEGACY.get(v.lower(), ""))


def reached(stage, target):
    """A record at `stage` has reached `target`: it is past it in the process and not Lost."""
    return stage is not None and target is not None and stage.kind != S.LOST and stage.position >= target.position


def is_backward(old, new):
    return old is not None and old.kind != S.LOST and new.kind != S.LOST and new.position < old.position


@transaction.atomic
def move(p, to, by, on=None, initial=False, baseline=False, refresh=True, old_steps="keep"):
    """Put a saved record into stage `to`: a StageEvent (backward moves are flagged for review), a Client Log line, the stage's
    framework steps (SRS v0.5 FR-SF5; the old framework's unfinished steps are kept or dropped, as old_steps says), and the
    owner's weekly KPIs worked out again. initial: the record was just added there; baseline: it was imported there, so the
    stages up to it count as reached without counting as this week's KPIs, and it gets no framework steps."""
    stages = stage_map()
    new = stages.get(to)
    if new is None or not new.active:
        raise PipelineError("Choose one of the team's stages.")
    if not initial and p.stage == to:
        return None
    on = on or today()
    old = None if initial else stages.get(p.stage)
    back = is_backward(old, new)
    ev = StageEvent.objects.create(record=p, owner_id=p.owner_id, from_stage="" if initial else p.stage, to_stage=to, day=on, by=by,
                                   backward=back, baseline=baseline, review=StageEvent.Review.FLAGGED if back else StageEvent.Review.NONE)
    p.stage, p.stage_since = to, on
    if new.kind != S.WON:
        p.won_verified_at, p.won_verified_by = None, None
    if not baseline:
        stamp_dates(p, new, on)
    p.save()
    note = f"Imported at {new.name}" if baseline else f"Added at {new.name}" if initial else f"{old.name if old else p.stage} → {new.name}" + (" · moved back, flagged for review" if back else "")
    ClientLogEntry.objects.create(record=p, type=ClientLogEntry.Type.STAGE, day=on, by=by, note=note)
    from frameworks import services as frameworks
    frameworks.on_stage_change(p, to, by, on, old_steps, baseline)
    if refresh:
        from . import kpis
        kpis.refresh(p.owner_id)
    return ev


def replay_dates(p, by):
    """A record from the old personal tracker: its lead, opportunity and client dates become stage events, so its KPI history
    is kept. Returns False when it had none (the caller then imports it as a baseline)."""
    bound = {k.key: k.stage.key for k in KpiType.objects.select_related("stage")}
    steps = sorted((d, bound[k]) for k, d in (("leads", p.lead_date), ("opps", p.opp_date), ("clients", p.client_date)) if d and k in bound)
    last = ""
    for d, to in steps:
        StageEvent.objects.create(record=p, owner_id=p.owner_id, from_stage=last, to_stage=to, day=d, by=by)
        last = to
    return bool(steps)


def stamp_dates(p, stage, on):
    """The dates a record first counted as a lead, opportunity or client (kept for the personal overview and the export)."""
    bound = {k.key: k.stage for k in KpiType.objects.select_related("stage")}
    for key, field in (("leads", "lead_date"), ("opps", "opp_date"), ("clients", "client_date")):
        if reached(stage, bound.get(key)) and not getattr(p, field):
            setattr(p, field, on)


# ---------- deal health (FR-K10) ----------

def health(p, stage, t=None):
    """One indicator per open record: the most urgent problem and what to do about it."""
    if stage is None or stage.kind != S.OPEN:
        return None
    t = t or today()
    if p.next_follow_up and p.next_follow_up < t:
        n = (t - p.next_follow_up).days
        return {"state": "danger", "label": f"Next step {n} {'day' if n == 1 else 'days'} overdue", "fix": "Do it today, or move the date if the plan changed."}
    if p.tender_deadline and t <= p.tender_deadline <= t + timedelta(days=3) and not stage.value_required:
        n = (p.tender_deadline - t).days
        return {"state": "danger", "label": "Tender closes today" if n == 0 else f"Tender closes in {n} {'day' if n == 1 else 'days'}",
                "fix": "Get the submission ready."}
    if stage.expected_days and p.stage_since and (t - p.stage_since).days > stage.expected_days:
        n = (t - p.stage_since).days
        return {"state": "warning", "label": f"{n} days in {stage.name} (usually {stage.expected_days})",
                "fix": f"Work towards: {stage.exit_criteria}." if stage.exit_criteria else "Move it on, or mark it lost if it has stalled."}
    last = p.last_contacted
    if last is None or (t - last).days > STALE_CONTACT_DAYS:
        return {"state": "warning", "label": "No contact logged yet" if last is None else f"No contact for {(t - last).days} days",
                "fix": "Log a call, email or visit."}
    return {"state": "good", "label": "On track", "fix": ""}


# ---------- Client Log (FR-CL1) ----------

CONTACT_TYPES = {ClientLogEntry.Type.CALL, ClientLogEntry.Type.EMAIL, ClientLogEntry.Type.WHATSAPP, ClientLogEntry.Type.VISIT, ClientLogEntry.Type.MEETING}


@transaction.atomic
def add_log(p, by, type, outcome="", note="", day=None, next_date=None, next_action=""):
    """Log an interaction. A contact updates "last contacted"; a next date (and action) becomes the record's next step."""
    day = day or today()
    if type == ClientLogEntry.Type.STAGE:
        raise PipelineError("Stage changes are logged automatically.")
    if day > today():
        raise PipelineError("Log what happened; plan what's next with the next date.")
    if next_date and next_date < day:
        raise PipelineError("The next date can't be before the day you're logging.")
    e = ClientLogEntry.objects.create(record=p, by=by, type=type, outcome=outcome.strip()[:120], note=note.strip()[:1000], day=day, next_date=next_date)
    fields = []
    if type in CONTACT_TYPES and (p.last_contacted is None or day > p.last_contacted):
        p.last_contacted = day
        fields.append("last_contacted")
    if next_date:
        p.next_follow_up = next_date
        p.next_action = (next_action or outcome or p.next_action or "Follow up").strip()[:200]
        fields += ["next_follow_up", "next_action"]
    if fields:
        p.save(update_fields=fields + ["updated_at"])
    return e


# ---------- supervisor review (FR-K2) ----------

def reviews():
    """Backward moves waiting for review, and wins waiting for the work order to be verified."""
    events = StageEvent.objects.filter(review=StageEvent.Review.FLAGGED).select_related("record", "owner").order_by("-day", "-id")[:200]
    won = [s.key for s in PipelineStage.objects.filter(kind=S.WON)]
    wins = Prospect.objects.filter(stage__in=won, won_verified_at__isnull=True).select_related("owner").order_by("-stage_since")[:200]
    stages = stage_map()
    name = lambda k: stages[k].name if k in stages else k  # noqa: E731
    from frameworks.services import stage_reviews
    return {
        "stages": stage_reviews(),
        "moves": [{"id": e.id, "record": e.record_id, "company": e.record.company, "person": e.owner.name or e.owner.email, "owner": e.owner_id,
                   "from": name(e.from_stage), "to": name(e.to_stage), "day": e.day} for e in events],
        "wins": [{"id": p.id, "company": p.company, "person": p.owner.name or p.owner.email, "owner": p.owner_id, "requirement": p.requirement,
                  "value": float(p.value) if p.value is not None else None, "day": p.stage_since, "why": p.win_loss_why} for p in wins],
    }


def _may_review(user, owner_id):
    if not user.can_approve:
        raise PipelineError("Only supervisors and admins review pipeline changes.")
    if owner_id == user.pk and not user.is_team_admin:
        raise PipelineError("Someone else reviews your own pipeline.")


@transaction.atomic
def review_move(user, event, note):
    _may_review(user, event.owner_id)
    event.review, event.review_note, event.reviewed_by, event.reviewed_at = StageEvent.Review.OK, note.strip()[:300], user, timezone.now()
    event.save(update_fields=["review", "review_note", "reviewed_by", "reviewed_at"])
    audit.log(user, "pipeline.review_move", event.record.company, record=event.record_id, note=event.review_note)
    return event


@transaction.atomic
def verify_win(user, p, verified, note=""):
    """Confirm a win's work order: only then does it count as a client and as revenue."""
    _may_review(user, p.owner_id)
    stage = stage_map().get(p.stage)
    if stage is None or stage.kind != S.WON:
        raise PipelineError("Only a won record can be verified.")
    if verified:
        p.won_verified_at, p.won_verified_by = timezone.now(), user
    else:
        if len(note.strip()) < 3:
            raise PipelineError("Say why the win isn't verified, so the owner can fix it.")
        p.won_verified_at, p.won_verified_by = None, None
        ClientLogEntry.objects.create(record=p, type=ClientLogEntry.Type.NOTE, day=today(), by=user, note=f"Win not verified: {note.strip()[:900]}")
    p.save(update_fields=["won_verified_at", "won_verified_by", "updated_at"])
    audit.log(user, "pipeline.verify_win" if verified else "pipeline.reject_win", p.company, record=p.id, note=note.strip()[:300])
    from . import kpis
    kpis.refresh(p.owner_id)
    return p
