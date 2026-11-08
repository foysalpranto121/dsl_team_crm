"""My Tasks API (SRS v0.5 §5.6): /api/tasks/…"""
from datetime import timedelta

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from team import services as team
from team.models import Task

from . import services
from .models import PersonalTask
from .serializers import TaskSerializer, context_for

T = PersonalTask
VIEWS = ["today", "upcoming", "overdue", "done", "open"]


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (services.TaskError, team.Locked) as e:
        raise ValidationError({"detail": str(e)})


class TaskViewSet(viewsets.ModelViewSet):
    """Your own tasks. view: today (due today), upcoming (later), overdue (open, past their date), done (done or dropped,
    last 60 days), open (all open; the default)."""

    serializer_class = TaskSerializer
    pagination_class = None

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **context_for(self.request)}

    def finalize_response(self, request, response, *args, **kwargs):
        if request.method not in ("GET", "HEAD", "OPTIONS") and getattr(response, "status_code", 500) < 400 and request.user.is_authenticated:
            from frameworks.services import check
            check(request.user.pk)         # the overdue count moved: the Overloaded flag follows it (SRS v0.5 FR-SF6)
        return super().finalize_response(request, response, *args, **kwargs)

    @extend_schema(parameters=[OpenApiParameter("view", str, enum=VIEWS)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = T.objects.filter(owner=self.request.user).select_related("client", "activity", "assigned_by")
        if self.action != "list":
            return qs
        today = team.today()
        view = self.request.query_params.get("view", "open")
        open_ = qs.filter(status=T.Status.OPEN)
        if view == "today":
            return open_.filter(due_date=today)
        if view == "upcoming":
            return open_.filter(due_date__gt=today)
        if view == "overdue":
            return open_.filter(due_date__lt=today)
        if view == "done":
            return qs.exclude(status=T.Status.OPEN).filter(updated_at__date__gte=today - timedelta(days=60)).order_by("-done_at", "-updated_at")
        return open_

    def perform_create(self, ser):
        ser.save(owner=self.request.user)

    def perform_destroy(self, t):
        if t.assigned_by_id:
            raise PermissionDenied("An assigned task can't be deleted. Drop it with a reason instead.")
        t.delete()

    def _out(self, t, **extra):
        return Response({**TaskSerializer(t, context=context_for(self.request)).data, **extra})

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def done(self, request, pk=None):
        """Done. A repeating task comes back on its next date; a task with an Activity Type offers the first free hour today."""
        t, nxt, hour = _call(services.complete, request.user, self.get_object())
        return self._out(t, next_task=nxt.id if nxt else None, free_hour=hour)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        t = self.get_object()
        t.status, t.done_at, t.drop_reason = T.Status.OPEN, None, ""
        t.save(update_fields=["status", "done_at", "drop_reason", "updated_at"])
        return self._out(t)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def drop(self, request, pk=None):
        t = self.get_object()
        reason = str(request.data.get("reason", "")).strip()[:200]
        if t.assigned_by_id and len(reason) < 3:
            raise ValidationError({"detail": "Say why you're dropping an assigned task."})
        t.status, t.drop_reason = T.Status.DROPPED, reason
        t.save(update_fields=["status", "drop_reason", "updated_at"])
        return self._out(t)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def log(self, request, pk=None):
        """FR-MT5: log the task in an hour of today's work log (body: {"hour": 0–9})."""
        try:
            hour = int(request.data.get("hour"))
        except (TypeError, ValueError):
            raise ValidationError({"detail": "Choose an hour."})
        day, hour = _call(services.log_as_hour, request.user, self.get_object(), hour)
        return self._out(self.get_object(), logged={"day": day, "hour": hour})


class WhenView(APIView):
    """What a natural date means (for the quick-add preview): ?text=tomorrow → {"date": …}."""

    @extend_schema(parameters=[OpenApiParameter("text", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"date": _call(services.parse_when, request.query_params.get("text", ""), team.today())})


class AssignInput(serializers.Serializer):
    person = serializers.IntegerField()
    title = serializers.CharField(max_length=200)
    due = serializers.CharField(max_length=40, required=False, allow_blank=True)
    due_time = serializers.TimeField(required=False, allow_null=True)
    activity = serializers.PrimaryKeyRelatedField(queryset=Task.objects.filter(active=True), required=False, allow_null=True)
    priority = serializers.ChoiceField(choices=T.Priority.choices, required=False, default=T.Priority.NORMAL)


class AssignView(APIView):
    """FR-MT4: supervisors and admins assign a task to someone, with a due date and Activity Type. It shows "Assigned by"
    and its hour is pre-approved."""

    @extend_schema(request=AssignInput, responses=TaskSerializer)
    def post(self, request):
        ser = AssignInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        due = _call(services.parse_when, d.get("due", ""), team.today())
        t = _call(services.assign, request.user, d["person"], " ".join(d["title"].split()), due, d.get("activity"), d["priority"], d.get("due_time"))
        return Response(TaskSerializer(t, context=context_for(request)).data, status=status.HTTP_201_CREATED)


class TeamView(APIView):
    """FR-MT6: per person, counts only (personal titles stay private), plus every assigned task."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.team_summary, request.user))
