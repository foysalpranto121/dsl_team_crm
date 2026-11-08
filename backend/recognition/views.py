"""Recognition API (SRS v0.5 §5.11): /api/recognition/…"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from team.services import Locked, parse_day

from . import services


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (services.RecognitionError, Locked) as e:
        raise ValidationError({"detail": str(e)})


class MeView(APIView):
    """Streaks, badges and days off. ?work=ID for a leader looking at their team."""

    @extend_schema(parameters=[OpenApiParameter("work", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.me, request.user, request.query_params.get("work")))


class FeedView(APIView):
    """FR-MO5: the win feed."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.feed(request.user))


class ReactView(APIView):
    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        _call(services.react, request.user, pk, str(request.data.get("kind") or ""))
        return Response({"ok": True})


class CelebrateView(APIView):
    """GET what this person hasn't seen yet. POST {"posts": […], "badges": […]} marks it seen."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.celebrate(request.user))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        services.mark_seen(request.user, request.data.get("posts") or [], request.data.get("badges") or [])
        return Response({"ok": True})


class ThanksView(APIView):
    """FR-MO6: a supervisor's word of thanks: {"work": id, "message": …}."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        p = _call(services.thanks, request.user, request.data.get("work"), str(request.data.get("message") or ""))
        return Response({"id": p.id})


class LeaveView(APIView):
    """FR-MO2: days off, which never break a streak. POST {"day": …, "reason": …}."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        day = _call(parse_day, str(request.data.get("day") or ""))
        if day is None:
            raise ValidationError({"day": "Pick a date."})
        r = _call(services.add_leave, request.user, day, str(request.data.get("reason") or ""))
        return Response({"id": r.id, "day": r.day, "reason": r.reason}, status=201)


class LeaveDayView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def delete(self, request, pk):
        _call(services.remove_leave, request.user, pk)
        return Response(status=204)
