"""SRS v0.5 FR-S1: the first configuration version, from today's configuration, and a ledger row for every hour that counts today, so
every number stays what it was. A version that applies to everything before any later one."""
from datetime import date
from decimal import Decimal

from django.db import migrations

METRICS = ("hours", "points", "leads", "opps", "clients", "revenue")
NOT_COUNTED = ("pending", "rejected", "flagged")


def source_of(m, task):
    if m.get("step"):
        return "step"
    if m.get("task"):
        return "task"
    if m.get("unplanned"):
        return "unplanned"
    if m.get("planned") is not None:
        return "plan" if m["planned"] == task else "deviation"
    return "legacy"


def forwards(apps, schema_editor):
    Task, JobRole, Sheet = apps.get_model("team", "Task"), apps.get_model("team", "JobRole"), apps.get_model("team", "Sheet")
    Entry, Settings = apps.get_model("team", "SheetEntry"), apps.get_model("team", "TeamSettings")
    Version, Ledger = apps.get_model("scoring", "ScoringVersion"), apps.get_model("scoring", "ScoreLedger")
    st = Settings.objects.filter(pk=1).first()
    count_weekend, weekend = (st.count_weekend, st.weekend_days or []) if st else (True, [5])
    tasks = {t.id: t for t in Task.objects.all()}
    config = {
        "points": {str(t.id): float(t.points) for t in tasks.values()},
        "weights": {str(r.id): {m: float(getattr(r, "w_" + m)) for m in METRICS} for r in JobRole.objects.all()},
        "sheets": {str(s.id): {"role": s.role_id, "targets": {m: float(getattr(s, "target_" + m)) for m in METRICS},
                               "start": s.start_date.isoformat() if s.start_date else None} for s in Sheet.objects.filter(kind="work")},
        "count_weekend": count_weekend,
    }
    v = Version.objects.create(number=1, effective_from=date(2000, 1, 1), kind="base", config=config)
    rows = []
    for e in Entry.objects.filter(sheet__kind="work").select_related("sheet").iterator(chunk_size=1000):
        if not count_weekend and (e.day.weekday() + 1) % 7 in weekend:
            continue
        for i, s in enumerate(e.slots or []):
            m = (e.meta[i] if e.meta and i < len(e.meta) else None) or {}
            if s is None or m.get("status") == "not_done" or m.get("review") in NOT_COUNTED:
                continue
            t = tasks.get(s)
            rows.append(Ledger(sheet_id=e.sheet_id, member_id=e.sheet.owner_id, day=e.day, slot=i, activity_id=s if t else None, activity_name=t.name if t else f"Task {s}",
                               category=(t.type or "Other") if t else "Other", points=t.points if t else Decimal(0), version=v, source=source_of(m, s)))
    Ledger.objects.bulk_create(rows, batch_size=1000)


def backwards(apps, schema_editor):
    apps.get_model("scoring", "ScoreLedger").objects.all().delete()
    apps.get_model("scoring", "ScoringVersion").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [("scoring", "0001_score_ledger"), ("team", "0013_work_order_events")]

    operations = [migrations.RunPython(forwards, backwards)]
