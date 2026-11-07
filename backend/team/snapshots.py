"""Automatic copies of the team's sheets, days and weekly results, taken before anything deletes them.

Each copy is a Backup row in the database (never served publicly), downloadable as a .json file. Only the newest KEEP are kept.
Accounts, tasks, job roles and team rules are not part of a snapshot, because deleting team data never touches them.
"""
import json
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.dateparse import parse_date
from django.utils.text import slugify

from core import audit

from . import services
from .models import Backup, JobRole, KpiEntry, Sheet, SheetEntry

KEEP = 30
TARGET_FIELDS = ["target_hours", "target_points", "target_leads", "target_opps", "target_clients", "target_revenue"]
KPI_FIELDS = ["leads", "opps", "clients"]
NAME = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}-[a-z0-9-]{1,40}\.json$")


def _sheet_data(s):
    return {"name": s.name, "kind": s.kind, "owner_id": s.owner_id, "person": s.person, "role": s.role.name if s.role else None,
            "targets": {f: str(getattr(s, f)) for f in TARGET_FIELDS}, "start_date": s.start_date.isoformat() if s.start_date else None,
            "position": s.position, "archived": s.archived,
            "entries": [{"day": e.day.isoformat(), "slots": e.slots, "meta": e.meta, "remarks": e.remarks} for e in s.entries.all()],
            "kpis": [_kpi_data(k) for k in s.kpis.all()]}


def _kpi_data(k):
    return {"week_start": k.week_start.isoformat(), **{f: getattr(k, f) for f in KPI_FIELDS}, "revenue": str(k.revenue), "notes": k.notes,
            "counts_in": k.counts_in}


def take(reason, actor=None):
    """Save a copy of all team data now. Returns the file name."""
    now = datetime.now(timezone.utc)
    sheets = [_sheet_data(s) for s in Sheet.objects.select_related("role").prefetch_related("entries", "kpis")]
    counts = {"sheets": len(sheets), "days": sum(len(s["entries"]) for s in sheets), "kpi_weeks": sum(len(s["kpis"]) for s in sheets)}
    name = f"{now:%Y%m%d-%H%M%S}-{secrets.token_hex(3)}-{slugify(reason)[:40] or 'backup'}.json"
    Backup.objects.create(name=name, created=now, reason=reason, counts=counts,
                          data={"format": 1, "created": now.isoformat(), "reason": reason, "counts": counts, "sheets": sheets})
    Backup.objects.filter(pk__in=list(Backup.objects.values_list("pk", flat=True)[KEEP:])).delete()
    audit.log(actor, "team.backup", name, reason=reason, **counts)
    return name


def _load(name):
    if not NAME.match(name):
        raise ValueError("Not a backup file name.")
    b = Backup.objects.filter(name=name).first()
    if b is None:
        raise FileNotFoundError(name)
    return b.data


def list_backups():
    return [{"name": b.name, "created": b.created.isoformat(), "reason": b.reason, **b.counts} for b in Backup.objects.defer("data")]


def read(name):
    """The backup as .json file bytes, for download."""
    if not NAME.match(name):
        raise FileNotFoundError(name)
    return json.dumps(_load(name), ensure_ascii=False, indent=1).encode("utf-8")


def restore(name, actor):
    """Replace all team data with a backup. The current data is backed up first, so this can be undone."""
    data = _load(name)
    before = take(f"before restoring {name}", actor)
    users = set(get_user_model().objects.values_list("id", flat=True))
    roles = {r.name: r for r in JobRole.objects.all()}
    with transaction.atomic():
        services.delete_team_data()
        for d in data["sheets"]:
            s = Sheet.objects.create(name=d["name"], kind=d["kind"], owner_id=d["owner_id"] if d["owner_id"] in users else None,
                                     person=d["person"], role=roles.get(d["role"]), start_date=parse_date(d["start_date"] or ""),
                                     position=d["position"], archived=d["archived"], **{f: Decimal(v) for f, v in d["targets"].items()})
            SheetEntry.objects.bulk_create([SheetEntry(sheet=s, day=parse_date(e["day"]), slots=e["slots"], meta=e.get("meta") or [], remarks=e["remarks"]) for e in d["entries"]])
            KpiEntry.objects.bulk_create([KpiEntry(sheet=s, week_start=parse_date(k["week_start"]), revenue=Decimal(k["revenue"]), notes=k["notes"], counts_in=k.get("counts_in", ""),
                                                   **{f: k[f] for f in KPI_FIELDS}) for k in d["kpis"]])
    audit.log(actor, "team.restore", name, flagged=True, backup_before=before, **data["counts"])
    return {**data["counts"], "backup_before": before}
