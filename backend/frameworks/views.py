"""Stage Frameworks API (SRS v0.5 §5.7): /api/frameworks/…

Framework Studio (supervisors and admins; everyone reads): frameworks, defaults, versions, applying a version to open records,
template packs. A record's steps (its owner works them; supervisors and management look). The team's load (Overloaded flags)."""
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from core import audit
from team import services as team
from tracker.models import Prospect
from tracker.pipeline import PipelineError

from . import packs, services
from .models import Framework, FrameworkAssignment, OverloadFlag, StepInstance
from .serializers import CompleteSerializer, DropSerializer, FrameworkSerializer, StepInstanceSerializer

S = StepInstance.Status


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except services.FrameworkError as e:
        raise ValidationError({"detail": str(e), **({"code": e.code} if e.code else {})})
    except (PipelineError, team.Locked) as e:
        raise ValidationError({"detail": str(e)})


class IsApproverOrReadOnly(BasePermission):
    """FR-SF1: supervisors and admins build frameworks; everyone approved reads them."""

    message = "Only supervisors and admins change frameworks."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_approved and (request.method in SAFE_METHODS or u.can_approve))


def _sees_team(user):
    return user.can_approve or user.role == User.Role.VIEWER


class FrameworkViewSet(viewsets.ModelViewSet):
    serializer_class = FrameworkSerializer
    permission_classes = [IsApproverOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = Framework.objects.select_related("stage", "updated_by").prefetch_related("steps", "rules")
        p = self.request.query_params
        if not _sees_team(self.request.user):
            qs = qs.filter(active=True)
        if p.get("stage"):
            qs = qs.filter(stage__key=p["stage"])
        return qs

    def perform_create(self, ser):
        fw = ser.save()
        audit.log(self.request.user, "framework.create", fw.name, stage=fw.stage.name, steps=fw.steps.count())

    def perform_update(self, ser):
        old = ser.instance.version
        fw = ser.save()
        audit.log(self.request.user, "framework.edit", fw.name, version=fw.version, new_version=fw.version != old)

    def perform_destroy(self, fw):
        if fw.assignments.exists():
            raise ValidationError({"detail": "Records have used this framework, so it stays on record. Switch it off instead."})
        audit.log(self.request.user, "framework.delete", fw.name)
        fw.delete()

    @extend_schema(request=None, responses=FrameworkSerializer)
    @action(detail=True, methods=["post"])
    def default(self, request, pk=None):
        """FR-SF4: records entering the stage (for this segment, if it has one) get this framework."""
        fw = _call(services.make_default, request.user, self.get_object())
        return Response(FrameworkSerializer(fw, context=self.get_serializer_context()).data)

    @extend_schema(request=None, responses=FrameworkSerializer)
    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        """A copy to change: frameworks can be many per stage (FR-SF4)."""
        src = self.get_object()
        snap = services.snapshot(src)
        fw = Framework.objects.create(name=f"{src.name} (copy)"[:80], description=src.description, stage=src.stage, segment=src.segment,
                                      outcomes=snap["outcomes"], created_by=request.user, updated_by=request.user)
        services.replace_steps(fw, snap["steps"], [{k: r[k] for k in ("outcome", "step_key", "action", "retry_days", "retry_max", "jump_key")} for r in snap["rules"]])
        services.save_version(fw, request.user)
        audit.log(request.user, "framework.duplicate", fw.name, source=src.name)
        return Response(FrameworkSerializer(fw, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        fw = self.get_object()
        return Response([{"number": v.number, "created_at": v.created_at, "by": services.person(v.created_by) or None, "steps": len(v.data.get("steps") or []),
                          "data": v.data} for v in fw.versions.select_related("created_by")[:50]])

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        """FR-SF7: what applying this version to the open records on older versions would change."""
        return Response(services.preview(self.get_object()))

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], url_path="apply")
    def apply_open(self, request, pk=None):
        return Response({"records": _call(services.apply_to_open, request.user, self.get_object())})


class PacksView(APIView):
    """FR-SF10: frameworks ship only as part of template packs, loaded on request as editable data."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(packs.listing())

    @extend_schema(request={"application/json": {"type": "object", "properties": {"key": {"type": "string"}}}}, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response(_call(packs.load, request.user, str(request.data.get("key") or "")))


def _record(request, pk, write=False):
    p = get_object_or_404(Prospect.objects.select_related("owner"), pk=pk)
    if p.owner_id != request.user.pk and (write or not _sees_team(request.user)):
        raise PermissionDenied("This record belongs to someone else.")
    return p


def _ctx(request):
    return {"request": request, "today": team.today()}


class RecordView(APIView):
    """A record's framework: the running one, its steps (and steps kept from earlier stages), and the others the member may pick."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        p = _record(request, pk)
        a = p.frameworks.filter(active=True).select_related("framework").first()
        steps = StepInstance.objects.filter(record=p).select_related("assignment__framework", "activity", "record")
        data = services.version_data(a) if a else None
        return Response({
            "assignment": {"id": a.id, "framework": a.framework_id, "name": a.framework.name, "version": a.version, "latest": a.framework.version,
                           "chosen": a.chosen, "started_on": a.started_on, "stage": a.stage, "outcomes": data.get("outcomes") or [],
                           "review_flag": a.review_flag and not a.reviewed_at, "review_note": a.review_note} if a else None,
            "steps": StepInstanceSerializer(steps, many=True, context=_ctx(request)).data,
            "choices": [{"id": f.id, "name": f.name, "segment": f.segment, "is_default": f.is_default, "steps": f.steps.count(), "description": f.description}
                        for f in services.choices_for(p)],
            "waiting": services.held(p.owner_id),
            "mine": p.owner_id == request.user.pk,
        })


class PickView(APIView):
    @extend_schema(request={"application/json": {"type": "object", "properties": {"framework": {"type": "integer"}, "old_steps": {"type": "string", "enum": ["keep", "drop"]}}}},
                   responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        p = _record(request, pk, write=True)
        fw = Framework.objects.filter(pk=request.data.get("framework")).first()
        if fw is None:
            raise ValidationError({"framework": "Choose a framework."})
        a = _call(services.pick, request.user, p, fw, request.data.get("old_steps") or "keep")
        return Response({"assignment": a.id}, status=status.HTTP_201_CREATED)


VIEWS = ["today", "overdue", "upcoming", "open", "waiting", "done"]


class StepViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Your own framework steps. view: today (due today), overdue, upcoming, open (all open; the default), waiting (held while
    you are flagged Overloaded), done (done, dropped or skipped in the last 60 days)."""

    serializer_class = StepInstanceSerializer
    pagination_class = None

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "today": team.today()}

    @extend_schema(parameters=[OpenApiParameter("view", str, enum=VIEWS)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = StepInstance.objects.filter(owner=self.request.user).select_related("assignment__framework", "activity", "record")
        if self.action != "list":
            return qs
        t = team.today()
        view = self.request.query_params.get("view", "open")
        if view == "waiting":
            return qs.filter(status=S.HELD)
        if view == "done":
            from datetime import timedelta
            return qs.filter(status__in=[S.DONE, S.DROPPED, S.SKIPPED], updated_at__date__gte=t - timedelta(days=60)).order_by("-updated_at")
        o = qs.filter(status=S.OPEN)
        return {"today": o.filter(due_date=t), "overdue": o.filter(due_date__lt=t), "upcoming": o.filter(due_date__gt=t)}.get(view, o)

    def _out(self, inst, **extra):
        inst = StepInstance.objects.select_related("assignment__framework", "activity", "record").get(pk=inst.pk)
        return Response({**StepInstanceSerializer(inst, context=self.get_serializer_context()).data, **extra})

    @extend_schema(request=CompleteSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """FR-SF3, FR-SF8: done with an outcome. Writes the Client Log and applies the outcome rule. The last step of an open
        record needs a dated next action (code next_required)."""
        ser = CompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        inst, result, hour = _call(services.complete, request.user, self.get_object(), d["outcome"], d["note"], d["next_date"], d["next_action"])
        return self._out(inst, result=result, free_hour=hour)

    @extend_schema(request=DropSerializer, responses=StepInstanceSerializer)
    @action(detail=True, methods=["post"])
    def drop(self, request, pk=None):
        ser = DropSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        return self._out(_call(services.drop, request.user, self.get_object(), d["reason"], d["next_date"], d["next_action"]))

    @extend_schema(request={"application/json": {"type": "object", "properties": {"due_date": {"type": "string", "format": "date"}}}},
                   responses=StepInstanceSerializer)
    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        try:
            due = team.parse_day(str(request.data.get("due_date") or ""))
        except Exception:
            raise ValidationError({"due_date": "Pick a date."})
        return self._out(_call(services.reschedule, request.user, self.get_object(), due))

    @extend_schema(request={"application/json": {"type": "object", "properties": {"hour": {"type": "integer"}}}}, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], url_path="log-hour")
    def log_hour(self, request, pk=None):
        try:
            hour = int(request.data.get("hour"))
        except (TypeError, ValueError):
            raise ValidationError({"hour": "Choose an hour."})
        day, hour = _call(services.log_hour, request.user, self.get_object(), hour)
        return Response({"day": day, "hour": hour})


class LoadView(APIView):
    """FR-SF6: the team's load. Each member's overdue items, waiting steps and Overloaded flag."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_call(services.team_load, request.user))


class OverrideView(APIView):
    @extend_schema(request={"application/json": {"type": "object", "properties": {"note": {"type": "string"}}}}, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        flag = get_object_or_404(OverloadFlag, pk=pk)
        _call(services.override, request.user, flag, str(request.data.get("note") or ""))
        return Response({"ok": True})


class MyLoadView(APIView):
    """The signed-in member's own flag, in plain words (no blame): how many items are overdue and whether new steps wait."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        from team.models import TeamSettings
        st = TeamSettings.load()
        flag = services.check(request.user.pk, st)
        n, days = services.overdue(request.user.pk, services.today(st), services.Calendar(st))
        return Response({"overdue": n, "oldest_days": days, "flagged": bool(flag), "waiting": StepInstance.objects.filter(owner=request.user, status=S.HELD).count(),
                         "overridden": bool(flag and flag.overridden_at), "threshold_items": st.overload_items, "threshold_days": st.overload_days})


class StageReviewView(APIView):
    """FR-SF3: a supervisor marks a record flagged by an outcome as reviewed."""

    @extend_schema(request={"application/json": {"type": "object", "properties": {"note": {"type": "string"}}}}, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        a = get_object_or_404(FrameworkAssignment.objects.select_related("record"), pk=pk)
        _call(services.review_stage, request.user, a, str(request.data.get("note") or ""))
        return Response({"ok": True})
