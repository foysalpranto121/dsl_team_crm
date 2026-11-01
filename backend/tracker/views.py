import json
import uuid

from django.db.models import Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsTeamAdmin
from team.services import Locked, parse_day

from . import services
from .models import Activity, PlanDay, Prospect, TrackerSettings
from .serializers import ActivitySerializer, PlanDayWriteSerializer, ProspectSerializer, TrackerSettingsSerializer

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
            qs = qs.filter(Q(company__icontains=q) | Q(contact__icontains=q) | Q(email__icontains=q) | Q(notes__icontains=q) | Q(next_action__icontains=q))
        return qs

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
            prospects = Prospect.objects.filter(owner=st.owner).exclude(stage__in=["client", "lost"]).order_by("next_follow_up")[:200]
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
