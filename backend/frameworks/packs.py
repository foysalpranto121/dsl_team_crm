"""Template packs (SRS v0.5 FR-SF10, FR-C10, §12.1). Frameworks ship only as part of a pack, loaded into a team that asks for it,
as editable data. Nothing here is loaded by default."""
from django.db import transaction

from core import audit
from tracker import pipeline

from . import services
from .models import Framework

RETRY_NO_ANSWER = {"outcome": "No answer", "action": "retry", "retry_days": 1, "retry_max": 2}
RETRY_LATER = {"outcome": "Call later", "action": "retry", "retry_days": 3, "retry_max": 2}
FLAG_NOT_INTERESTED = {"outcome": "Not interested", "action": "flag"}
STANDARD_RULES = [RETRY_NO_ANSWER, RETRY_LATER, FLAG_NOT_INTERESTED]


def step(day, type, title, instruction="", stop_on=()):
    return {"day_offset": day, "type": type, "title": title, "instruction": instruction, "stop_on": list(stop_on)}


# §12.1 Seed Pack: Software B2B Sales: one starter framework per stage (follow-up calls, emails, visits, proposal follow-up,
# lost-deal nurture). Stages are matched by key, then by name.
PACKS = {
    "b2b-sales": {
        "name": "Software B2B Sales",
        "description": "One starter framework per stage of the default sales process: follow-up calls, emails, visits, proposal "
                       "follow-up and lost-deal nurture.",
        "frameworks": [
            {"stage": "lead", "name": "First contact", "description": "Reach a new lead and confirm the need within a week.",
             "steps": [step(0, "call", "First call: introduce us and ask about the need"),
                       step(1, "email", "Send the introduction email and company profile"),
                       step(3, "call", "Follow-up call: did they read it?"),
                       step(5, "whatsapp", "Short WhatsApp check-in"),
                       step(7, "call", "Last try: confirm interest or close the lead", stop_on=["Not interested"])],
             "rules": STANDARD_RULES},
            {"stage": "qualified", "name": "14-day follow-up", "description": "Turn a qualified lead into shared requirements in two weeks.",
             "steps": [step(0, "call", "Discovery call: budget, authority, need, timing"),
                       step(2, "email", "Send a relevant case study"),
                       step(4, "call", "Follow-up call on the case study"),
                       step(7, "visit", "Visit: meet the decision maker"),
                       step(10, "email", "Ask for the written requirements"),
                       step(14, "call", "Requirements check: shared, or close the lead")],
             "rules": STANDARD_RULES},
            {"stage": "requirements", "name": "Requirements to solution", "description": "Understand the requirements and book the demo.",
             "steps": [step(0, "prep", "Review the requirements with the team"),
                       step(1, "email", "Confirm our understanding in writing"),
                       step(3, "call", "Book the solution demo"),
                       step(6, "call", "Follow-up if the demo isn't booked yet")],
             "rules": STANDARD_RULES},
            {"stage": "demo", "name": "Demo follow-up", "description": "Show the solution and get agreement that it fits.",
             "steps": [step(0, "demo", "Run the demo"),
                       step(1, "email", "Send the demo recap and next steps"),
                       step(3, "call", "Follow-up call: questions and fit"),
                       step(5, "proposal", "Prepare the proposal")],
             "rules": STANDARD_RULES},
            {"stage": "proposal", "name": "Proposal follow-up", "description": "Follow the proposal or tender through to a decision.",
             "steps": [step(0, "proposal", "Submit the proposal or tender"),
                       step(2, "call", "Confirm they received it"),
                       step(5, "call", "Follow-up: questions on the proposal"),
                       step(8, "visit", "Clarification meeting"),
                       step(12, "call", "Decision check")],
             "rules": STANDARD_RULES},
            {"stage": "negotiation", "name": "Close the deal", "description": "Agree terms and receive the work order.",
             "steps": [step(0, "call", "Negotiation call: open points"),
                       step(2, "email", "Send the revised offer"),
                       step(4, "visit", "Negotiation meeting"),
                       step(7, "call", "Ask for the work order")],
             "rules": STANDARD_RULES},
            {"stage": "lost", "name": "Lost-deal nurture", "description": "Stay in touch with lost clients for the next chance.",
             "steps": [step(20, "email", "Keep-in-touch email with something useful", stop_on=["Not interested"]),
                       step(60, "call", "Check-in call: has anything changed?", stop_on=["Not interested"]),
                       step(120, "email", "Share news and offers", stop_on=["Not interested"])],
             "rules": [RETRY_NO_ANSWER]},
        ],
    },
}


def listing():
    loaded = set(Framework.objects.exclude(pack="").values_list("pack", flat=True))
    return [{"key": k, "name": p["name"], "description": p["description"], "frameworks": len(p["frameworks"]), "loaded": k in loaded}
            for k, p in PACKS.items()]


@transaction.atomic
def load(user, key):
    """Load a pack's frameworks as editable data. A framework already loaded from the pack is skipped; each becomes its stage's
    default when the stage has none."""
    if not user.can_approve:
        raise services.NotAllowed("Only supervisors and admins load template packs.")
    pack = PACKS.get(key)
    if pack is None:
        raise services.FrameworkError("There's no such template pack.")
    stages = pipeline.stage_map(active_only=True)
    created, skipped = [], []
    for spec in pack["frameworks"]:
        stage = pipeline.resolve(spec["stage"], stages)
        if stage is None:
            skipped.append({"name": spec["name"], "why": f"The team has no {spec['stage']} stage."})
            continue
        if Framework.objects.filter(pack=key, name=spec["name"], stage=stage).exists():
            skipped.append({"name": spec["name"], "why": "Already loaded."})
            continue
        fw = Framework.objects.create(name=spec["name"], description=spec["description"], stage=stage, pack=key, created_by=user, updated_by=user)
        services.replace_steps(fw, spec["steps"], [{"step_key": "", "retry_days": 1, "retry_max": 2, "jump_key": "", **r} for r in spec["rules"]])
        services.save_version(fw, user)
        if services.default_for(stage.key) is None:
            fw.is_default = True
            fw.save(update_fields=["is_default"])
        created.append({"id": fw.id, "name": fw.name, "stage": stage.name, "default": fw.is_default})
    audit.log(user, "framework.load_pack", pack["name"], created=len(created), skipped=len(skipped))
    return {"created": created, "skipped": skipped}
