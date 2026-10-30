"""Automatic copies of the team's sheets, days and weekly results, taken before anything deletes them.

Files are JSON in backend/snapshots/ (not under MEDIA_ROOT, which is served publicly). Only the newest KEEP are kept.
Accounts, tasks, job roles and team rules are not part of a snapshot, because deleting team data never touches them.
"""
import json
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.dateparse import parse_date
from django.utils.text import slugify

from core import audit

from . import services
from .models import JobRole, KpiEntry, Sheet, SheetEntry

FOLDER = settings.BASE_DIR / "snapshots"
KEEP = 30
TARGET_FIELDS = ["target_hours", "target_points", "target_leads", "target_opps", "target_clients", "target_revenue"]
KPI_FIELDS = ["leads", "opps", "clients"]
NAME = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}-[a-z0-9-]{1,40}\.json$")


def _sheet_data(s):
    return {"name": s.name, "kind": s.kind, "owner_id": s.owner_id, "person": s.person, "role": s.role.name if s.role else None,
            "targets": {f: str(getattr(s, f)) for f in TARGET_FIELDS}, "start_date": s.start_date.isoformat() if s.start_date else None,
            "position": s.position, "archived": s.archived,
            "entries": [{"day": e.day.isoformat(), "slots": e.slots, "remarks": e.remarks} for e in s.entries.all()],
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
    FOLDER.mkdir(parents=True, exist_ok=True)
    (FOLDER / name).write_text(json.dumps({"format": 1, "created": now.isoformat(), "reason": reason, "counts": counts, "sheets": sheets},
                                          ensure_ascii=False, indent=1), encoding="utf-8")
    for old in sorted(FOLDER.glob("*.json"), reverse=True)[KEEP:]:
        old.unlink()
    audit.log(actor, "team.backup", name, reason=reason, **counts)
    return name


def _load(name):
    if not NAME.match(name):
        raise ValueError("Not a backup file name.")
    return json.loads((FOLDER / name).read_text(encoding="utf-8"))


def list_backups():
    if not FOLDER.exists():
        return []
    out = []
    for path in sorted(FOLDER.glob("*.json"), reverse=True):
        data = _load(path.name)
        out.append({"name": path.name, "created": data["created"], "reason": data["reason"], **data["counts"]})
    return out


def read(name):
    """The backup file's bytes, for download."""
    if not NAME.match(name) or not (FOLDER / name).exists():
        raise FileNotFoundError(name)
    return (FOLDER / name).read_bytes()


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
            SheetEntry.objects.bulk_create([SheetEntry(sheet=s, day=parse_date(e["day"]), slots=e["slots"], remarks=e["remarks"]) for e in d["entries"]])
            KpiEntry.objects.bulk_create([KpiEntry(sheet=s, week_start=parse_date(k["week_start"]), revenue=Decimal(k["revenue"]), notes=k["notes"], counts_in=k.get("counts_in", ""),
                                                   **{f: k[f] for f in KPI_FIELDS}) for k in d["kpis"]])
    audit.log(actor, "team.restore", name, flagged=True, backup_before=before, **data["counts"])
    return {**data["counts"], "backup_before": before}
