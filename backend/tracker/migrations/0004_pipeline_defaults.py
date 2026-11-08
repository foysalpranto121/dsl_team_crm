"""SRS v0.5 defaults: the sales process (Lead → … → Won / Lost) and the four KPIs bound to stage events. Records keep their
place: the old stages are mapped onto the new ones, and the dates a record first became a lead, opportunity or client are
replayed as stage events, so the KPI history worked out from them matches what was there."""
from django.db import migrations

STAGES = [   # key, name, kind, expected days, probability, value required, exit criteria
    ("lead", "Lead", "open", 7, 5, False, "Contact made and the need confirmed"),
    ("qualified", "Qualified Lead", "open", 14, 10, False, "Budget, authority, need and timing checked"),
    ("requirements", "Requirements Shared", "open", 10, 25, False, "The client shared their requirements"),
    ("demo", "Solution / Demo", "open", 10, 40, False, "Solution shown and the client agrees it fits"),
    ("proposal", "Proposal / Tender Submitted", "open", 21, 60, True, "Proposal or tender submitted"),
    ("negotiation", "Negotiation", "open", 14, 80, True, "Terms agreed; waiting for the work order"),
    ("won", "Won", "won", None, 100, True, "Work order received"),
    ("lost", "Lost", "lost", None, 0, False, ""),
]
KPIS = [   # key, name, definition, stage, verified wins only
    ("leads", "Qualified leads", "A record reaches Qualified Lead.", "qualified", False),
    ("opps", "Opportunities", "A record reaches Requirements Shared.", "requirements", False),
    ("clients", "Clients", "A record is Won and a supervisor verified the work order.", "won", True),
    ("revenue", "Revenue", "The value of verified wins.", "won", True),
]
LEGACY = {"prospect": "lead", "contacted": "lead", "lead": "qualified", "opp": "requirements", "client": "won", "lost": "lost"}
BACK = {"lead": "prospect", "qualified": "lead", "requirements": "opp", "demo": "opp", "proposal": "opp", "negotiation": "opp", "won": "client", "lost": "lost"}


def forward(apps, schema_editor):
    Stage, KpiType = apps.get_model("tracker", "PipelineStage"), apps.get_model("tracker", "KpiType")
    Prospect, Event = apps.get_model("tracker", "Prospect"), apps.get_model("tracker", "StageEvent")
    if not Stage.objects.exists():
        for i, (key, name, kind, days, prob, value, exit_) in enumerate(STAGES, start=1):
            Stage.objects.create(key=key, name=name, kind=kind, position=i, expected_days=days, probability=prob, value_required=value, exit_criteria=exit_)
    by_key = {s.key: s for s in Stage.objects.all()}
    for key, name, definition, stage, verified in KPIS:
        if stage in by_key:
            KpiType.objects.get_or_create(key=key, defaults={"name": name, "definition": definition, "stage": by_key[stage], "verified_only": verified})
    events = []
    for p in Prospect.objects.all():
        old = p.stage
        p.stage = LEGACY.get(old, old if old in by_key else "lead")
        steps = [(p.lead_date, "qualified"), (p.opp_date, "requirements"), (p.client_date, "won")]
        last, day = "", None
        for d, to in steps:
            if d:
                events.append(Event(record=p, owner_id=p.owner_id, from_stage=last, to_stage=to, day=d))
                last, day = to, d
        if p.stage == "lost" and last != "lost":
            d = (p.updated_at.date() if p.updated_at else None) or day or p.created_at.date()
            events.append(Event(record=p, owner_id=p.owner_id, from_stage=last, to_stage="lost", day=d))
            day = d
        p.stage_since = day or (p.created_at.date() if p.created_at else None)
        if p.stage == "won" and p.client_date:   # wins from before the change were already counted as clients: keep them verified
            p.won_verified_at = p.updated_at
        p.save(update_fields=["stage", "stage_since", "won_verified_at"])
    Event.objects.bulk_create(events)


def backward(apps, schema_editor):
    Prospect = apps.get_model("tracker", "Prospect")
    for p in Prospect.objects.all():
        p.stage = BACK.get(p.stage, "prospect")
        if p.stage == "prospect" and p.last_contacted:
            p.stage = "contacted"
        p.save(update_fields=["stage"])


class Migration(migrations.Migration):
    dependencies = [("tracker", "0003_pipelinestage_prospect_deal_currency_and_more")]
    operations = [migrations.RunPython(forward, backward)]
