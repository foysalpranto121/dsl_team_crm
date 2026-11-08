"""The Daily Playbook API (SRS v0.5 §5.8): /api/playbook/…"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from team.services import Locked
from tracker.pipeline import PipelineError

from . import services


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (services.PlaybookError, Locked, PipelineError) as e:
        raise ValidationError({"detail": str(e)})


class TodayView(APIView):
    """Today's list, live. POST {"action": "start" | "close" | "reopen"}."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.build, request.user))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        fn = {"start": services.start_day, "close": services.close_day, "reopen": services.reopen_day}.get(request.data.get("action"))
        if fn is None:
            raise ValidationError({"action": "Use start, close or reopen."})
        return Response(_call(fn, request.user))


class NoteView(APIView):
    """FR-DP5: {"note": …} replaces the day note. {"text": …, "client": id?} adds a quick note, to the Client Log when it has a client."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if "note" in request.data:
            return Response({"note": _call(services.set_note, request.user, str(request.data.get("note") or ""))})
        return Response(_call(services.quick_note, request.user, str(request.data.get("text") or ""), request.data.get("client")))


class SlotView(APIView):
    """P1: {"hour": 0–9, "status": "done" | "partly" | "not_done" | "undo", "reason": …}."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        try:
            hour = int(request.data.get("hour"))
        except (TypeError, ValueError):
            raise ValidationError({"hour": "Choose an hour."})
        return Response(_call(services.log_slot, request.user, hour, str(request.data.get("status") or ""), str(request.data.get("reason") or "")))


class AddToPlanView(APIView):
    """P4: {"type": "step" | "task", "id": …}."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(services.add_to_plan, request.user, request.data.get("type"), request.data.get("id")))


class LetGoView(APIView):
    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(services.let_go, request.user, str(request.data.get("key") or ""), str(request.data.get("reason") or "")))


class SuggestionView(APIView):
    """FR-AC1, FR-AC8: {"useful": true | false} or {"dismiss": true}."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        if request.data.get("dismiss"):
            _call(services.dismiss_suggestion, request.user, pk)
        else:
            _call(services.suggestion_feedback, request.user, pk, bool(request.data.get("useful")))
        return Response({"ok": True})


class HistoryView(APIView):
    """FR-DP6: recent days' snapshots."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.history, request.user))
