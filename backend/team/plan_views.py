"""Planning and approval API (SRS v0.5 §5.2, §6): /api/team/plans/… and /api/team/board/…
A week is chosen with ?week=<any day in it>; whose plan with ?work=<their work log id> (default: your own)."""
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import planning, services
from .models import Sheet

WHO = [OpenApiParameter("work", int, description="The person's work log (default: yours)"), OpenApiParameter("week", str, description="Any day of the week")]


def _work(request, value):
    if value:
        return get_object_or_404(Sheet, pk=value, kind=Sheet.Kind.WORK)
    work = planning.work_of_user(request.user)
    if work is None:
        raise NotFound("You don't have a daily log yet, so there's no week to plan. Ask an admin to set one up in Team setup.")
    return work


def _day(value):
    try:
        return services.parse_day(value, services.today())
    except services.Locked as e:
        raise ValidationError({"detail": str(e)})


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except planning.NotAllowed as e:
        raise PermissionDenied(str(e))
    except (planning.PlanError, services.Locked) as e:
        raise ValidationError({"detail": str(e)})


class _Week(serializers.Serializer):
    work = serializers.IntegerField(required=False)
    week = serializers.DateField(required=False)


class GoalsInput(_Week):
    goals = serializers.CharField(max_length=1000, allow_blank=True)


class ActionInput(_Week):
    action = serializers.ChoiceField(choices=["submit", "withdraw"])
    goals = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class CopyInput(_Week):
    source = serializers.ChoiceField(choices=["last_week", "day", "template"])
    day = serializers.DateField(required=False)
    template = serializers.IntegerField(required=False)


class TemplateInput(_Week):
    name = serializers.CharField(max_length=80)


class ItemInput(serializers.Serializer):
    work = serializers.IntegerField()
    day = serializers.DateField()
    slot = serializers.IntegerField(min_value=0, max_value=9)
    kind = serializers.ChoiceField(choices=["plan", "log"])


class DecideInput(serializers.Serializer):
    items = ItemInput(many=True, allow_empty=False, max_length=700)
    decision = serializers.ChoiceField(choices=["approve", "reject", "flag", "unflag"])
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    task = serializers.IntegerField(required=False, help_text="Approve at another task (edit and approve).")


def _input(cls, request):
    ser = cls(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data
    return d, _work(request, d.get("work")), d.get("week") or services.today()


class PlanWeekView(APIView):
    """One week of a person's plan: each hour's task and state, each day's logged hours and adherence, and what you may do."""

    @extend_schema(parameters=WHO, responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(planning.week(request.user, _work(request, request.query_params.get("work")), _day(request.query_params.get("week"))))

    @extend_schema(request=GoalsInput, responses=OpenApiTypes.OBJECT)
    def patch(self, request):
        """The week's goals."""
        d, work, day = _input(GoalsInput, request)
        _call(planning.save_goals, request.user, work, day, d["goals"])
        return Response(planning.week(request.user, work, day))


class PlanActionView(APIView):
    """submit: send the week's draft and rejected hours on days still open (FR-P2, FR-P6); withdraw: take back hours that
    are waiting for approval."""

    @extend_schema(request=ActionInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        d, work, day = _input(ActionInput, request)
        n = _call(planning.act, request.user, work, day, d["action"], d.get("goals"))
        return Response({"hours": n, **planning.week(request.user, work, day)})


class PlanCopyView(APIView):
    """Fill the week's empty, open days from last week, from one day of this week, or from a template (FR-P4)."""

    @extend_schema(request=CopyInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        d, work, day = _input(CopyInput, request)
        filled = _call(planning.copy, request.user, work, day, d["source"], d.get("day"), d.get("template"))
        return Response({"filled": filled, **planning.week(request.user, work, day)})


class PlanTemplatesView(APIView):
    """Your saved weeks (FR-P4). POST saves the chosen week under a name (the same name replaces it)."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(planning.templates(request.user))

    @extend_schema(request=TemplateInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        d, work, day = _input(TemplateInput, request)
        _call(planning.save_template, request.user, work, day, d["name"])
        return Response(planning.templates(request.user))


class PlanTemplateView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def delete(self, request, pk):
        _call(planning.delete_template, request.user, pk)
        return Response(planning.templates(request.user))


class PlanHistoryView(APIView):
    """A person's weeks with plan against actual and adherence, newest first."""

    @extend_schema(parameters=WHO[:1], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(planning.history(request.user, _work(request, request.query_params.get("work"))))


class PlanMineView(APIView):
    """For the bell: hours waiting for your decision, and the state of your own plan this week and next week."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(planning.mine(request.user))


class BoardView(APIView):
    """The Team Board (FR-P5): everyone's week, what waits for a decision, and planned coverage by kind of work."""

    @extend_schema(parameters=WHO[1:], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(planning.board, request.user, _day(request.query_params.get("week"))))


class BoardDecideView(APIView):
    """Approve, reject, flag or unflag many hours at once (FR-P2, FR-P5, D1). Nobody decides on their own hours."""

    @extend_schema(request=DecideInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = DecideInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        n = _call(planning.decide, request.user, d["items"], d["decision"], d.get("note", ""), d.get("task"))
        return Response({"changed": n})
