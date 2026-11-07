from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsApproved, IsTeamAdmin
from core import audit
from team import services as team

from . import importer, services
from .models import Contract, Renewal, RenewalSettings
from .serializers import (ContractSerializer, LoseSerializer, RenewalSerializer, RenewalSettingsSerializer, RenewalUpdateSerializer,
                          RenewSerializer)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except services.NotAllowed as e:
        raise PermissionDenied(str(e))
    except services.Invalid as e:
        raise ValidationError({"detail": str(e)})


class TodayContext:
    """Serializers need today's date (team time zone) and the first reminder window."""

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "on": team.today(), "first_window": RenewalSettings.load().ordered_windows[0]}


class ContractViewSet(TodayContext, viewsets.ModelViewSet):
    """Contracts for sold software, licences and AMCs (SRS FR-RN1). Admins and management see every contract, members the
    ones they own. Only admins add, change, import and delete them."""

    serializer_class = ContractSerializer
    pagination_class = None

    def get_permissions(self):
        return [IsApproved()] if self.action in ("list", "retrieve") else [IsTeamAdmin()]

    @extend_schema(parameters=[OpenApiParameter("status", str, enum=Contract.Status.values)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        services.sync()
        qs = services.contracts_for(self.request.user)
        status_ = self.request.query_params.get("status")
        return qs.filter(status=status_) if status_ in Contract.Status.values else qs

    def _fresh(self, ser, c):
        ser.instance = services.contracts_for(self.request.user).get(pk=c.pk)   # with its renewal as it is now

    def perform_create(self, ser):
        c = ser.save(created_by=self.request.user)
        audit.log(self.request.user, "contract.create", c, ends=str(c.end_date), value=str(c.value))
        services.after_contract_change(c)
        self._fresh(ser, c)

    def perform_update(self, ser):
        before = {k: str(getattr(ser.instance, k)) for k in ser.validated_data}
        old_value = ser.instance.value
        c = ser.save()
        audit.log(self.request.user, "contract.update", c, before=before, after={k: str(v) for k, v in ser.validated_data.items()})
        services.after_contract_change(c, old_value)
        self._fresh(ser, c)

    def perform_destroy(self, c):
        r = services.renewal_of(c)
        won = r is not None and r.stage == Renewal.Stage.WON
        audit.log(self.request.user, "contract.delete", c, flagged=won, status=c.status, value=str(c.value), ends=str(c.end_date))
        c.delete()

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {
        "file": {"type": "string", "format": "binary"}, "dry_run": {"type": "boolean", "default": True}}}}, responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["post"], url_path="import", parser_classes=[MultiPartParser])
    def import_csv(self, request):
        """Import contracts from a CSV file. dry_run (the default) only checks the file and says what would happen."""
        f = request.FILES.get("file")
        if f is None:
            raise ValidationError({"detail": "Choose a CSV file."})
        if f.size > importer.MAX_BYTES:
            raise ValidationError({"detail": "The file is bigger than 2 MB. Split it into smaller files."})
        dry_run = str(request.data.get("dry_run", "true")).lower() in ("1", "true", "yes")
        try:
            return Response(importer.run(request.user, f.read(), dry_run=dry_run))
        except importer.BadFile as e:
            raise ValidationError({"detail": str(e)})


class RenewalViewSet(TodayContext, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Renewal opportunities (SRS FR-RN2). They open by themselves at the first reminder window; the account owner or an
    admin works them and records the outcome. Management reads."""

    serializer_class = RenewalSerializer
    pagination_class = None

    @extend_schema(parameters=[OpenApiParameter("show", str, enum=["open", "closed", "all"], default="open")])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        services.sync()
        qs = services.renewals_for(self.request.user)
        if self.action == "list":
            show = self.request.query_params.get("show", "open")
            if show == "open":
                qs = qs.filter(stage__in=Renewal.OPEN_STAGES)
            elif show == "closed":
                qs = qs.exclude(stage__in=Renewal.OPEN_STAGES)
        return qs

    def _out(self, r, **extra):
        fresh = services.renewals_for(self.request.user).get(pk=r.pk)
        return Response({**self.get_serializer(fresh).data, **extra})

    @extend_schema(request=RenewalUpdateSerializer, responses=RenewalSerializer)
    def partial_update(self, request, pk=None):
        """Stage, next step and its date, expected value, upsell idea."""
        r = self.get_object()
        ser = RenewalUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        if not ser.validated_data:
            raise ValidationError({"detail": "Nothing to change."})
        return self._out(_call(services.update, request.user, r, ser.validated_data))

    @extend_schema(request=RenewSerializer, responses=RenewalSerializer)
    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        """The client renewed. Starts the next term as a new contract; the value counts in the owner's Revenue KPI."""
        r = self.get_object()
        ser = RenewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        r, new = _call(services.renew, request.user, r, d["start_date"], d["end_date"], d["value"], d.get("terms"), d.get("renewed_on"))
        return self._out(r, next_term=new.id)

    @extend_schema(request=LoseSerializer, responses=RenewalSerializer)
    @action(detail=True, methods=["post"])
    def lose(self, request, pk=None):
        """The client isn't renewing, with the reason."""
        r = self.get_object()
        ser = LoseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return self._out(_call(services.lose, request.user, r, ser.validated_data["reason"].strip()))

    @extend_schema(request=None, responses=RenewalSerializer)
    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """Admins: undo an outcome recorded by mistake."""
        return self._out(_call(services.reopen, request.user, self.get_object()))


class SummaryView(APIView):
    """The renewal dashboard (SRS FR-RN3): due by month, renewal rate, revenue at risk, upsell ideas."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.summary(request.user))


class DueView(APIView):
    """The signed-in person's renewals whose next step is due: the notification bell and the to-do list."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.due_for(request.user))


class SettingsView(APIView):
    """Reminder windows and how much renewal revenue counts in the Revenue KPI. Everyone reads; admins change."""

    def get_permissions(self):
        return [IsTeamAdmin()] if self.request.method == "PATCH" else [IsApproved()]

    @extend_schema(responses=RenewalSettingsSerializer)
    def get(self, request):
        return Response(RenewalSettingsSerializer(RenewalSettings.load()).data)

    @extend_schema(request=RenewalSettingsSerializer, responses=RenewalSettingsSerializer)
    def patch(self, request):
        s = RenewalSettings.load()
        before = {"windows": s.windows, "revenue_weight": str(s.revenue_weight)}
        ser = RenewalSettingsSerializer(s, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        s = ser.save()
        after = {"windows": s.windows, "revenue_weight": str(s.revenue_weight)}
        audit.log(request.user, "renewal.settings", "Renewal settings", flagged=before["revenue_weight"] != after["revenue_weight"],
                  before=before, after=after)
        services.sync(force=True)
        return Response(RenewalSettingsSerializer(s).data, status=status.HTTP_200_OK)
