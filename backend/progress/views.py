"""My Progress, the Weekly Review and the AI Coach's reading of the numbers (SRS v0.5 §5.9, §5.11, §5.12): /api/progress/…"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from team.services import Locked

from . import services


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (services.ProgressError, Locked) as e:
        raise ValidationError({"detail": str(e)})


class MeView(APIView):
    """Rings, gaps, forecast, target vs achievement, catch-up plan, task analysis and the recap. ?work=ID for a leader looking at their team (D9)."""

    @extend_schema(parameters=[OpenApiParameter("work", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.me, request.user, request.query_params.get("work")))


class ReviewView(APIView):
    """FR-WR1. GET the week's review (?week=, ?work=). POST {"action": "confirm_kpi" | "confirm_deals" | "focus" | "submit_plan" | "submit", "week": …, "focus": …}."""

    @extend_schema(parameters=[OpenApiParameter("week", str), OpenApiParameter("work", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.review, request.user, request.query_params.get("work"), request.query_params.get("week")))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(services.act, request.user, str(request.data.get("action") or ""), request.data.get("week"), str(request.data.get("focus") or "")))


class TeamReviewView(APIView):
    """FR-WR2, FR-AC5: the supervisor's 15-minute team review, from the same data."""

    @extend_schema(parameters=[OpenApiParameter("week", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.team_review, request.user, request.query_params.get("week")))


class BriefView(APIView):
    """FR-AC6: the supervisor's morning brief."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.brief, request.user))


class RecordCoachView(APIView):
    """FR-AC4: a record's next best action, last contact, days in stage, similar past wins and losses."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        return Response(_call(services.record_coach, request.user, pk))
