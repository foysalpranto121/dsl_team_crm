"""Weekly KPIs worked out from the pipeline (SRS v0.5 FR-K2, FR-K3, FR-K5).

Each KPI Type is bound to a stage: a record counts once for it, in the week it first reaches that stage (Clients and Revenue
also need the win verified). The numbers are written into the person's weekly KPI rows (team.KpiEntry), so the dashboard,
performance, export and TV read them as before. A supervisor may adjust a week with a note (audit-logged); the member
confirms the week in one tap. Weeks before the team's cut-over date keep the numbers typed in."""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from core import audit
from team import calc
from team import services as team_services
from team.models import KpiEntry, Sheet, TeamSettings

from . import pipeline
from .models import KpiType, PipelineStage, Prospect, StageEvent

METRICS = ("leads", "opps", "clients", "revenue")
Src = KpiEntry.Source


class KpiError(Exception):
    pass


def zero():
    return {"leads": 0, "opps": 0, "clients": 0, "revenue": 0.0}


def sheet_for(owner_id):
    """The person's work log, where their weekly KPIs live."""
    return Sheet.objects.filter(kind=Sheet.Kind.WORK, owner_id=owner_id).order_by("archived", "id").first()


def counted(owner_id):
    """({kpi key: {record id: day}}, {record id: value}): the day each record first counted for each KPI."""
    stages = {s.key: s for s in PipelineStage.objects.all()}
    types = list(KpiType.objects.select_related("stage"))
    out = {t.key: {} for t in types}
    seen = {t.key: set() for t in types}   # reached before the record was imported: never counts
    for e in StageEvent.objects.filter(owner_id=owner_id).only("record_id", "to_stage", "day", "baseline").order_by("day", "id"):
        at = stages.get(e.to_stage)
        for t in types:
            if e.record_id in out[t.key] or e.record_id in seen[t.key] or not pipeline.reached(at, t.stage):
                continue
            if e.baseline:
                seen[t.key].add(e.record_id)
            else:
                out[t.key][e.record_id] = e.day
    ids = set().union(*out.values()) if out else set()
    records = {p.id: p for p in Prospect.objects.filter(id__in=ids).only("id", "company", "value", "won_verified_at", "stage")}
    won = {s.key for s in stages.values() if s.kind == PipelineStage.Kind.WON}
    for t in types:
        if t.verified_only:
            out[t.key] = {r: d for r, d in out[t.key].items() if r in records and records[r].stage in won and records[r].won_verified_at}
    return out, records


def by_week(owner_id, st):
    cfg = team_services.cfg_of(st)
    out, records = counted(owner_id)
    weeks = defaultdict(zero)
    for key, recs in out.items():
        for rid, day in recs.items():
            ws = calc.week_start_of(day, cfg)
            if key == "revenue":
                weeks[ws]["revenue"] = round(weeks[ws]["revenue"] + float(records[rid].value or 0), 2)
            else:
                weeks[ws][key] += 1
    return weeks


def _apply(k, nums):
    """Derived numbers plus the supervisor's adjustments become the week's numbers."""
    adj = k.adjust or {}
    k.source, k.derived = Src.DERIVED, {m: nums[m] for m in METRICS}
    k.leads, k.opps, k.clients = (max(0, int(nums[m]) + int(adj.get(m, 0))) for m in ("leads", "opps", "clients"))
    k.revenue = Decimal(str(max(0.0, nums["revenue"] + float(adj.get("revenue", 0))))).quantize(Decimal("0.01"))
    k.save()
    return k


def current(k):
    return {"leads": k.leads, "opps": k.opps, "clients": k.clients, "revenue": float(k.revenue)}


@transaction.atomic
def refresh(owner_id, st=None):
    """Work the person's weekly KPIs out again from their stage events (every week from the cut-over on)."""
    st = st or TeamSettings.load()
    if not team_services.kpi_derived(st):
        return
    sheet = sheet_for(owner_id)
    if sheet is None:
        return
    weeks = by_week(owner_id, st)
    rows = KpiEntry.objects.select_for_update().filter(sheet=sheet)
    if st.kpi_from:
        rows = rows.filter(week_start__gte=st.kpi_from)
    existing = {k.week_start: k for k in rows}
    for ws in sorted(set(weeks) | set(existing)):
        if not team_services.kpi_derived(st, ws):
            continue
        nums = weeks.get(ws, zero())
        k = existing.get(ws)
        if k is None:
            if not any(nums.values()):
                continue
            k = KpiEntry(sheet=sheet, week_start=ws)
        elif k.source == Src.TYPED and any(current(k).values()):
            audit.log(None, "kpi.typed_replaced", sheet, week=str(ws), typed=current(k))   # a typed week inside the derived range
        _apply(k, nums)


def refresh_all(st=None):
    st = st or TeamSettings.load()
    for owner_id in Sheet.objects.filter(kind=Sheet.Kind.WORK, owner__isnull=False).values_list("owner_id", flat=True).distinct():
        refresh(owner_id, st)


def evidence(owner_id, ws, st=None):
    """The records behind a week's numbers, and wins that will count once verified."""
    st = st or TeamSettings.load()
    end = ws + timedelta(days=6)
    out, records = counted(owner_id)
    ev = {m: [] for m in METRICS}
    for key, recs in out.items():
        for rid, day in sorted(recs.items(), key=lambda x: x[1]):
            if ws <= day <= end:
                p = records[rid]
                ev[key].append({"id": rid, "company": p.company, "day": day, "value": float(p.value) if p.value is not None else None})
    won = [s.key for s in PipelineStage.objects.filter(kind=PipelineStage.Kind.WON)]
    waiting = Prospect.objects.filter(owner_id=owner_id, stage__in=won, won_verified_at__isnull=True, stage_since__range=(ws, end))
    return {"counted": ev, "waiting": [{"id": p.id, "company": p.company, "value": float(p.value) if p.value is not None else None} for p in waiting]}


def _week_row(sheet, ws, st):
    if not team_services.kpi_derived(st, ws):
        raise KpiError("This week's numbers are typed in, not worked out from the pipeline.")
    if sheet.owner_id:
        refresh(sheet.owner_id, st)
    k = KpiEntry.objects.select_for_update().filter(sheet=sheet, week_start=ws).first()
    return k or _apply(KpiEntry(sheet=sheet, week_start=ws), zero())


@transaction.atomic
def confirm(user, sheet, ws):
    """FR-K3: the member confirms the week's numbers in one tap."""
    st = TeamSettings.load()
    if sheet.owner_id != user.pk:
        raise KpiError("You confirm your own week; a supervisor adjusts other people's.")
    if ws > team_services.today(st):
        raise KpiError("That week hasn't started yet.")
    k = _week_row(sheet, ws, st)
    k.confirmed, k.confirmed_by, k.confirmed_at = current(k), user, timezone.now()
    k.save(update_fields=["confirmed", "confirmed_by", "confirmed_at", "updated_at"])
    audit.log(user, "kpi.confirm", sheet, week=str(ws), **{m: str(v) for m, v in k.confirmed.items()})
    return k


@transaction.atomic
def adjust(user, sheet, ws, values, note):
    """FR-K2: a supervisor corrects a week (the final numbers), with a note. Stored as the difference from the derived numbers,
    so later pipeline changes still show up."""
    st = TeamSettings.load()
    if not user.can_approve:
        raise KpiError("Only supervisors and admins adjust weekly KPIs.")
    if sheet.owner_id == user.pk and not user.is_team_admin:
        raise KpiError("Someone else adjusts your own week.")
    if len((note or "").strip()) < 3:
        raise KpiError("Say why you're changing the numbers.")
    k = _week_row(sheet, ws, st)
    before, derived = current(k), {**zero(), **(k.derived or {})}
    adj = {}
    for m in METRICS:
        if m in values and values[m] is not None:
            diff = round(float(values[m]) - float(derived[m]), 2)
            if diff:
                adj[m] = diff if m == "revenue" else int(diff)
    k.adjust, k.adjust_note, k.adjusted_by, k.adjusted_at = adj, note.strip()[:300], user, timezone.now()
    _apply(k, derived)
    audit.log(user, "kpi.adjust", sheet, flagged=True, week=str(ws), before=before, after=current(k), note=k.adjust_note)
    return k
