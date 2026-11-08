"""The score ledger API (SRS v0.5 §5.4, §7): /api/scoring/…

ledger/: the entries behind any number (FR-S3). versions/: the configuration versions (FR-C9, FR-S4). recalculate/: the one way history
changes (§7), with a preview first. events/: event-based activities and their verification (D2, FR-T5)."""
from datetime import date

from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsTeamAdmin
from team import calc
from team import services as team
from team.models import Sheet

from . import services
from .models import EventLog
from .serializers import EventSerializer, EventWriteSerializer

KPI_METRICS = ("leads", "opps", "clients", "revenue")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (services.ScoringError, team.Locked) as e:
        raise ValidationError({"detail": str(e)})


def _day(value, label):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({label: "Use a date like 2026-10-29."})


class LedgerView(APIView):
    """FR-S3, acceptance test 6: the entries behind a number. ?sheet=ID (empty = the whole team) &from=&to=.
    metric=leads|opps|clients|revenue gives what a KPI number came from, instead of ledger rows."""

    @extend_schema(parameters=[OpenApiParameter("sheet", int), OpenApiParameter("from", str), OpenApiParameter("to", str), OpenApiParameter("metric", str)],
                   responses=OpenApiTypes.OBJECT)
    def get(self, request):
        p = request.query_params
        frm, to = _day(p.get("from"), "from"), _day(p.get("to"), "to")
        if to < frm or (to - frm).days > 800:
            raise ValidationError({"to": "Ask for up to about two years at a time."})
        sheets = Sheet.objects.filter(kind=Sheet.Kind.WORK).select_related("owner").prefetch_related("kpis")
        if p.get("sheet"):
            sheets = sheets.filter(pk=p["sheet"])
        else:
            sheets = sheets.filter(archived=False)
        sheets = list(sheets)
        if p.get("sheet") and not sheets:
            raise ValidationError({"sheet": "That daily log doesn't exist."})
        metric = p.get("metric") or ""
        if metric and metric not in KPI_METRICS:
            raise ValidationError({"metric": "Use leads, opps, clients or revenue."})
        body = services.kpi_evidence(sheets, frm, to, metric) if metric else services.rows_for([s.id for s in sheets], frm, to)
        return Response({"from": frm, "to": to, "metric": metric or None, "currency": team.TeamSettings.load().currency, **body})


class VersionsView(APIView):
    """FR-C9, FR-S4: every configuration version, newest first: what changed, from when, who did it."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"versions": services.versions_list(), "current_month": calc.month_start(team.today())})


class RecalculatePreviewView(APIView):
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(services.preview, request.data.get("from")))


class RecalculateView(APIView):
    """§7: applies today's configuration from a month on, as a new version. Needs a reason; flagged in the activity log."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(services.recalculate, request.user, request.data.get("from"), str(request.data.get("reason") or "")))


class EventViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Your own events by default. ?scope=team for supervisors, management and admins; ?sheet=ID for one daily log; ?status=pending."""

    serializer_class = EventSerializer
    pagination_class = None
    queryset = EventLog.objects.select_related("sheet", "activity", "decided_by", "record")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "book": services.Book()}

    def list(self, request, *args, **kwargs):
        p = request.query_params
        qs = _call(services.events_for, request.user, p.get("scope") or "mine", p.get("status") or None, p.get("sheet") or None, p.get("from") or None, p.get("to") or None)
        return Response(EventSerializer(qs[:300], many=True, context=self.get_serializer_context()).data)

    @extend_schema(request=EventWriteSerializer, responses=EventSerializer)
    def create(self, request, *args, **kwargs):
        ser = EventWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        ev = _call(services.log_event, request.user, d["sheet"], d["day"], d["activity"], d["quantity"], d["evidence"], d.get("note", ""))
        return Response(EventSerializer(ev, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        _call(services.withdraw_event, request.user, self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=EventSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """{"verified": true} counts it from now on, on its own date; false needs a note and removes its points."""
        ev = get_object_or_404(self.get_queryset(), pk=pk)
        ev = _call(services.decide_event, request.user, ev, bool(request.data.get("verified")), str(request.data.get("note") or ""))
        return Response(EventSerializer(ev, context=self.get_serializer_context()).data)
