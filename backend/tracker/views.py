import json
import uuid

from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminOrReadOnly, IsTeamAdmin
from core import audit
from team.models import TeamSettings
from team.services import Locked, parse_day

from . import kpis, pipeline, services
from .models import Activity, ClientLogEntry, KpiType, PipelineStage, PlanDay, Prospect, StageEvent, TrackerSettings
from .serializers import (ActivitySerializer, ClientLogSerializer, KpiTypeSerializer, PlanDayWriteSerializer, ProspectSerializer, StageSerializer,
                          TrackerSettingsSerializer)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (pipeline.PipelineError, kpis.KpiError) as e:
        raise ValidationError({"detail": str(e)})

# Everything here belongs to the signed-in person only; querysets are always filtered by owner.


class SettingsView(APIView):
    @extend_schema(responses=TrackerSettingsSerializer)
    def get(self, request):
        return Response(TrackerSettingsSerializer(services.settings_for(request.user)).data)

    @extend_schema(request=TrackerSettingsSerializer, responses=TrackerSettingsSerializer)
    def patch(self, request):
        ser = TrackerSettingsSerializer(services.settings_for(request.user), data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


def period_param(request):
    """?period=n picks a period (0 = the first one from the start date); without it, the one today falls in."""
    v = request.query_params.get("period")
    if v in (None, ""):
        return None
    try:
        n = int(v)
    except ValueError:
        raise ValidationError("period must be a whole number.")
    if not 0 <= n <= 1200:
        raise ValidationError("That period is out of range.")
    return n


class SummaryView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.summary(request.user, period_param(request)))


class ProspectViewSet(viewsets.ModelViewSet):
    serializer_class = ProspectSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Prospect.objects.filter(owner=self.request.user)
        p = self.request.query_params
        if p.get("stage"):
            qs = qs.filter(stage=p["stage"])
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(company__icontains=q) | Q(contact__icontains=q) | Q(email__icontains=q) | Q(notes__icontains=q) | Q(next_action__icontains=q)
                           | Q(requirement__icontains=q))
        return qs

    def perform_destroy(self, p):
        owner = p.owner_id
        p.delete()
        kpis.refresh(owner)   # its stage events go with it

    @extend_schema(request=ClientLogSerializer, responses=ClientLogSerializer(many=True))
    @action(detail=True, methods=["get", "post"])
    def log(self, request, pk=None):
        """The record's Client Log (FR-CL1), newest first. POST logs an interaction."""
        p = self.get_object()
        if request.method == "POST":
            ser = ClientLogSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            d = ser.validated_data
            e = _call(pipeline.add_log, p, request.user, d["type"], d.get("outcome", ""), d.get("note", ""), d.get("day"), d.get("next_date"), d.get("next_action", ""))
            return Response(ClientLogSerializer(e).data, status=status.HTTP_201_CREATED)
        return Response(ClientLogSerializer(p.log.select_related("by")[:300], many=True).data)

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}}}, responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["post"], url_path="import", parser_classes=[MultiPartParser])
    def import_csv(self, request):
        f = request.FILES.get("file")
        if not f or f.size > 5 * 1024 * 1024:
            raise ValidationError("Choose a CSV file up to 5 MB.")
        try:
            return Response(services.import_csv(request.user, f.read().decode("utf-8-sig", errors="replace")))
        except ValueError as e:
            raise ValidationError(str(e))

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=False, methods=["get"], url_path="export")
    def export_csv(self, request):
        resp = HttpResponse(services.export_csv(request.user), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="prospects-{services.today()}.csv"'
        return resp


class ActivityViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = ActivitySerializer
    pagination_class = None

    def get_queryset(self):
        qs = Activity.objects.filter(owner=self.request.user)
        p = self.request.query_params
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "settings": services.settings_for(self.request.user)}

    def perform_create(self, ser):
        ser.save(owner=self.request.user)


class PlanView(APIView):
    """The daily plan for a date range: saved days, or the template's tasks for days not changed yet."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        st = services.settings_for(request.user)
        info = services.period_info(st, period_param(request))
        start, end = info["start"], info["end"]
        try:
            frm = parse_day(request.query_params.get("from"), start)
            to = parse_day(request.query_params.get("to"), end)
        except Locked as e:
            raise ValidationError(str(e))
        if to < frm or (to - frm).days > 130:
            raise ValidationError("Ask for up to about four months at a time.")
        return Response({"days": services.plan_days(st, request.user, frm, to), "weeks": services.weeks(st, info["n"]), "period": info, "today": services.today()})


class PlanDayView(APIView):
    @extend_schema(request=PlanDayWriteSerializer, responses=OpenApiTypes.OBJECT)
    def put(self, request, day):
        try:
            d = parse_day(day)
        except Locked as e:
            raise ValidationError(str(e))
        ser = PlanDayWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        tasks = [{**t, "id": t["id"] or uuid.uuid4().hex[:10]} for t in ser.validated_data["tasks"]]
        p, _ = PlanDay.objects.update_or_create(owner=request.user, date=d, defaults={"tasks": tasks, "note": ser.validated_data.get("note", "")})
        return Response({"date": p.date, "tasks": p.tasks, "note": p.note, "edited": True})

    @extend_schema(responses={204: None})
    def delete(self, request, day):
        """Reset a day to the template's tasks."""
        try:
            d = parse_day(day)
        except Locked as e:
            raise ValidationError(str(e))
        PlanDay.objects.filter(owner=request.user, date=d).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeamPipelinesView(APIView):
    """Admins: the pipelines people chose to share (read-only). Nothing is shown for anyone who didn't opt in."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        out = []
        for st in TrackerSettings.objects.filter(share_with_admins=True, owner__status="approved", owner__is_active=True).select_related("owner"):
            s = services.summary(st.owner)
            closed = PipelineStage.objects.exclude(kind=PipelineStage.Kind.OPEN).values_list("key", flat=True)
            prospects = Prospect.objects.filter(owner=st.owner).exclude(stage__in=list(closed)).order_by("next_follow_up")[:200]
            out.append({"user": {"id": st.owner.id, "name": st.owner.name or st.owner.email}, "product": st.product, "funnel": s["funnel"],
                        "totals": s["totals"], "targets": s["targets"], "due_count": s["due_count"], "period": s["period"],
                        "prospects": [{"id": p.id, "company": p.company, "contact": p.contact, "country": p.country, "stage": p.stage,
                                       "next_follow_up": p.next_follow_up, "next_action": p.next_action} for p in prospects]})
        return Response({"people": out})


class BackupImportView(APIView):
    """Bring in a backup (.json) from the original single-page tracker."""
    parser_classes = [MultiPartParser, JSONParser]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}}}, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        f = request.FILES.get("file")
        if not f or f.size > 20 * 1024 * 1024:
            raise ValidationError("Choose the backup .json file (up to 20 MB).")
        try:
            data = json.loads(f.read().decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            raise ValidationError("That file isn't a valid backup (.json).")
        try:
            return Response(services.import_backup(request.user, data))
        except ValueError as e:
            raise ValidationError(str(e))


# ---------- SRS v0.5 §5.5: the team's sales process, KPI bindings and reviews ----------

class ConfigView(APIView):
    """Everything the pipeline screens need in one call: stages, KPI bindings, lost reasons, currency, Client Log types."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        st = TeamSettings.load()
        counts = dict(Prospect.objects.values_list("stage").annotate(n=Count("id")))
        return Response({
            "stages": StageSerializer(PipelineStage.objects.all(), many=True, context={"_counts": counts}).data,
            "kpi_types": KpiTypeSerializer(KpiType.objects.select_related("stage"), many=True).data,
            "lost_reasons": st.lost_reasons or [], "currency": st.currency, "kpi_mode": st.kpi_mode, "kpi_from": st.kpi_from,
            "log_types": [{"key": k, "label": label} for k, label in ClientLogEntry.Type.choices if k != ClientLogEntry.Type.STAGE],
        })


class StageViewSet(viewsets.ModelViewSet):
    """FR-K9: everyone reads the stages; admins change them. A stage in use is switched off rather than deleted."""

    serializer_class = StageSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None
    queryset = PipelineStage.objects.all()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "_counts": dict(Prospect.objects.values_list("stage").annotate(n=Count("id")))}

    def perform_create(self, ser):
        if "position" not in ser.validated_data:
            last = PipelineStage.objects.order_by("-position").first()
            ser.validated_data["position"] = (last.position + 1) if last else 1
        s = ser.save()
        audit.log(self.request.user, "pipeline.stage_add", s.name)

    def perform_update(self, ser):
        s = ser.save()
        audit.log(self.request.user, "pipeline.stage_change", s.name, **{k: str(v) for k, v in ser.validated_data.items()})
        kpis.refresh_all()

    def perform_destroy(self, s):
        if Prospect.objects.filter(stage=s.key).exists() or StageEvent.objects.filter(Q(to_stage=s.key) | Q(from_stage=s.key)).exists() \
                or KpiType.objects.filter(stage=s).exists():
            raise ValidationError({"detail": "This stage is in use. Switch it off instead."})
        audit.log(self.request.user, "pipeline.stage_delete", s.name, flagged=True)
        s.delete()

    @extend_schema(request=OpenApiTypes.OBJECT, responses=StageSerializer(many=True))
    @action(detail=False, methods=["post"], permission_classes=[IsTeamAdmin])
    def order(self, request):
        """Put the stages in this order: {"keys": [...]}."""
        keys = request.data.get("keys")
        stages = {s.key: s for s in PipelineStage.objects.all()}
        if not isinstance(keys, list) or sorted(keys) != sorted(stages):
            raise ValidationError({"detail": "Send every stage key once, in the new order."})
        for i, k in enumerate(keys, start=1):
            if stages[k].position != i:
                stages[k].position = i
                stages[k].save(update_fields=["position"])
        audit.log(request.user, "pipeline.stage_order", "stages", keys=keys)
        kpis.refresh_all()
        return Response(StageSerializer(PipelineStage.objects.all(), many=True, context=self.get_serializer_context()).data)


class KpiTypeViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """FR-C6: what each weekly KPI counts. Admins rename it, change its definition or the stage it counts."""

    serializer_class = KpiTypeSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None
    queryset = KpiType.objects.select_related("stage")

    def perform_update(self, ser):
        k = ser.save()
        audit.log(self.request.user, "kpi.type_change", k.name, flagged=True, **{f: str(v) for f, v in ser.validated_data.items()})
        kpis.refresh_all()


class ReviewsView(APIView):
    """FR-K2 for supervisors and admins: backward stage moves to review, and wins whose work order needs verifying."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not request.user.can_approve:
            raise PermissionDenied("Only supervisors and admins review pipeline changes.")
        return Response(pipeline.reviews())


class ReviewMoveView(APIView):
    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        e = get_object_or_404(StageEvent.objects.select_related("record"), pk=pk, review=StageEvent.Review.FLAGGED)
        _call(pipeline.review_move, request.user, e, str(request.data.get("note", "")))
        return Response({"ok": True})


class VerifyWinView(APIView):
    """{"verified": true} confirms the work order (the win then counts as a client and as revenue); false sends it back with a note."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        p = get_object_or_404(Prospect, pk=pk)
        _call(pipeline.verify_win, request.user, p, bool(request.data.get("verified")), str(request.data.get("note", "")))
        return Response({"ok": True, "verified": bool(p.won_verified_at)})


class RecalculateView(APIView):
    """Admins: work every person's weekly KPIs out again from the pipeline (after changing stages or KPI bindings)."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        kpis.refresh_all()
        audit.log(request.user, "kpi.recalculate", "weekly KPIs", flagged=True)
        return Response({"ok": True})
