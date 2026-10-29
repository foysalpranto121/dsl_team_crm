from datetime import date, timedelta

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminOrReadOnly, IsApproved, IsTeamAdmin
from core import audit

from . import calc, services
from .exporter import build_workbook
from .importer import WorkbookError, import_workbook
from .models import JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings
from .serializers import (EntrySerializer, EntryWriteSerializer, JobRoleSerializer, KpiSerializer, SheetSerializer, TaskSerializer,
                          TeamSettingsSerializer)

DAY = r"(?P<day>\d{4}-\d{2}-\d{2})"


def locked(e):
    return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)


def task_points():
    return {t.id: float(t.points) for t in Task.objects.all()}


class TeamSettingsView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    @extend_schema(responses=TeamSettingsSerializer)
    def get(self, request):
        return Response(TeamSettingsSerializer(TeamSettings.load()).data)

    @extend_schema(request=TeamSettingsSerializer, responses=TeamSettingsSerializer)
    def patch(self, request):
        ser = TeamSettingsSerializer(TeamSettings.load(), data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        audit.log(request.user, "settings.save", "team settings", **{k: str(v) for k, v in ser.validated_data.items()})
        return Response(ser.data)


class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def perform_create(self, ser):
        audit.log(self.request.user, "task.save", ser.save().name, points=str(ser.validated_data.get("points", "")))

    def perform_update(self, ser):
        before = {k: str(getattr(ser.instance, k)) for k in ser.validated_data}
        t = ser.save()
        audit.log(self.request.user, "task.save", t.name, before=before, after={k: str(v) for k, v in ser.validated_data.items()})

    def destroy(self, request, *args, **kwargs):
        task = self.get_object()
        if SheetEntry.objects.filter(slots__contains=[task.id]).exists():
            return Response({"detail": "This task is used in sheets. Switch it off instead, so past points stay correct."}, status=400)
        return super().destroy(request, *args, **kwargs)


class JobRoleViewSet(viewsets.ModelViewSet):
    queryset = JobRole.objects.prefetch_related("tasks")
    serializer_class = JobRoleSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def perform_create(self, ser):
        audit.log(self.request.user, "role.save", ser.save().name)

    def perform_update(self, ser):
        r = ser.save()
        audit.log(self.request.user, "role.save", r.name, weights=r.weights, tasks=r.tasks.count())


class SheetViewSet(viewsets.ModelViewSet):
    """Sheets: everyone sees them; admins create, rename, set targets and archive. Entries and weekly results are nested."""

    serializer_class = SheetSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = Sheet.objects.select_related("owner", "role")
        return qs if self.request.query_params.get("archived") == "1" else qs.filter(archived=False)

    def get_permissions(self):
        if self.action in ("entry", "kpi"):   # members write here too; services.entry_block / kpi_block decide
            return [IsApproved()]
        return super().get_permissions()

    def perform_destroy(self, sheet):
        audit.log(self.request.user, "sheet.delete", sheet.name, flagged=True, days=sheet.entries.count(), kpi_weeks=sheet.kpis.count())
        sheet.delete()

    def perform_update(self, ser):
        before = {k: str(getattr(ser.instance, k)) for k in ser.validated_data}
        obj = ser.save()
        audit.log(self.request.user, "sheet.save", obj, before=before, after={k: str(v) for k, v in ser.validated_data.items()})

    # ----- daily entries -----
    @extend_schema(parameters=[OpenApiParameter("from", str), OpenApiParameter("to", str)], responses=EntrySerializer(many=True))
    @action(detail=True, methods=["get"])
    def entries(self, request, pk=None):
        sheet = self.get_object()
        st = TeamSettings.load()
        t = services.today(st)
        try:
            frm = services.parse_day(request.query_params.get("from"), calc.month_start(t))
            to = services.parse_day(request.query_params.get("to"), calc.month_end(frm))
        except services.Locked as e:
            raise ValidationError(str(e))
        if to < frm or (to - frm).days > 400:
            raise ValidationError("Ask for up to about a year at a time.")
        rows = sheet.entries.filter(day__range=(frm, to)).select_related("updated_by")
        editable, blocked, d = {}, {}, frm
        while d <= to:   # which days this person may change, by the server's clock, and why not
            reason = services.entry_block(request.user, sheet, d, st)
            editable[d.isoformat()] = reason is None
            if reason:
                blocked[d.isoformat()] = reason
            d += timedelta(days=1)
        return Response({"from": frm, "to": to, "today": t, "editable": editable, "blocked": blocked,
                         "entries": EntrySerializer(rows, many=True, context={"pts": task_points()}).data,
                         **services.sheet_summary(sheet, frm, to, st)})

    @extend_schema(request=EntryWriteSerializer, responses=EntrySerializer)
    @action(detail=True, methods=["put", "delete"], url_path=f"entries/{DAY}")
    def entry(self, request, pk=None, day=None):
        sheet = self.get_object()
        try:
            d = services.parse_day(day)
            if request.method == "DELETE":
                services.save_entry(request.user, sheet, d, [], "")
                return Response(status=status.HTTP_204_NO_CONTENT)
            ser = EntryWriteSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            e = services.save_entry(request.user, sheet, d, ser.validated_data["slots"], ser.validated_data.get("remarks"))
        except services.Locked as err:
            return locked(err)
        if e is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(EntrySerializer(e, context={"pts": task_points()}).data)

    # ----- weekly results -----
    @extend_schema(parameters=[OpenApiParameter("year", int)], responses=KpiSerializer(many=True))
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        sheet = self.get_object()
        year = int(request.query_params.get("year") or services.today().year)
        rows = sheet.kpis.filter(week_start__gte=date(year, 1, 1) - timedelta(days=6), week_start__lte=date(year, 12, 31)).select_related("updated_by")
        return Response(KpiSerializer(rows, many=True).data)

    @extend_schema(request=KpiSerializer, responses=KpiSerializer)
    @action(detail=True, methods=["put"], url_path=f"kpis/{DAY}")
    def kpi(self, request, pk=None, day=None):
        sheet = self.get_object()
        ser = KpiSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            k = services.save_kpi(request.user, sheet, services.parse_day(day), ser.validated_data)
        except services.Locked as err:
            return locked(err)
        return Response(KpiSerializer(k).data)


class TodayView(APIView):
    """What 'today' is for the team, how long until it locks, and whether my sheets are filled in."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        st = TeamSettings.load()
        cfg, t = services.cfg_of(st), services.today(st)
        ws = calc.week_start_of(t, cfg)
        mine = list(Sheet.objects.filter(owner=request.user, archived=False))
        filled = set(SheetEntry.objects.filter(sheet__in=mine, day=t).values_list("sheet_id", flat=True))
        return Response({"today": t, "timezone": st.timezone, "lock_days": st.lock_days,
                         "seconds_to_lock": calc.seconds_to_midnight(st.timezone, services.now()),
                         "week_start": ws, "week_no": calc.week_no(ws, cfg)[0],
                         "my_sheets": [{"id": s.id, "name": s.name, "kind": s.kind, "filled_today": s.id in filled} for s in mine]})


class DashboardView(APIView):
    @extend_schema(parameters=[OpenApiParameter("date", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        try:
            on = services.parse_day(request.query_params.get("date"))
        except services.Locked as e:
            raise ValidationError(str(e))
        on, rows = services.dashboard_rows(on)
        return Response({"date": on, "rows": rows})


class PerformanceView(APIView):
    @extend_schema(parameters=[OpenApiParameter("year", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        t = services.today()
        year = int(request.query_params.get("year") or t.year)
        on, rows = services.performance_rows(year, t)
        return Response({"year": year, "date": on, "rows": rows})


class KpiWeekView(APIView):
    """Every work sheet's results for one week, and whether the signed-in person may change each row."""

    @extend_schema(parameters=[OpenApiParameter("week", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        st = TeamSettings.load()
        cfg, t = services.cfg_of(st), services.today(st)
        try:
            ws = calc.week_start_of(services.parse_day(request.query_params.get("week"), t), cfg)
        except services.Locked as e:
            raise ValidationError(str(e))
        sheets = list(services.work_sheets().select_related("owner", "role"))
        kpis = {k.sheet_id: k for k in KpiEntry.objects.filter(sheet__in=sheets, week_start=ws).select_related("updated_by")}
        rows = []
        for s in sheets:
            reason = services.kpi_block(request.user, s, ws, st)
            rows.append({"sheet": s.id, "name": s.name, "person": s.person or (s.owner.name if s.owner else s.name), "role": s.role.name if s.role else None,
                         "mine": s.owner_id == request.user.pk, "editable": reason is None, "blocked": reason,
                         "kpi": KpiSerializer(kpis[s.id]).data if s.id in kpis else None,
                         "targets": {"leads": float(s.target_leads), "opps": float(s.target_opps), "clients": float(s.target_clients), "revenue": float(s.target_revenue)}})
        year, month = calc.month_of_week(ws)
        return Response({"week_start": ws, "week_end": ws + timedelta(days=6), "week_no": calc.week_no(ws, cfg)[0], "today": t,
                         "current_week_start": calc.week_start_of(t, cfg), "counts_in_month": f"{year}-{month:02d}", "rows": rows})


class ExportView(APIView):
    """The Team Operation Sheet as an .xlsx file: every sheet for a year, or just one (?sheet=ID)."""

    @extend_schema(parameters=[OpenApiParameter("year", int), OpenApiParameter("sheet", int)], responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
    def get(self, request):
        t = services.today()
        try:
            year = int(request.query_params.get("year") or t.year)
            sheet = int(request.query_params["sheet"]) if request.query_params.get("sheet") else None
        except ValueError:
            raise ValidationError("year and sheet must be numbers.")
        if not 2000 <= year <= 2100:
            raise ValidationError("Choose a year between 2000 and 2100.")
        data = build_workbook(year, [sheet] if sheet else None)
        name = f"DSL Team Operation Sheet {year}.xlsx"
        if sheet:
            s = Sheet.objects.filter(pk=sheet).first()
            name = f"DSL {s.name if s else 'Sheet'} {year}.xlsx"
        resp = HttpResponse(data, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = f'attachment; filename="{name}"'
        return resp


class ImportView(APIView):
    """Admins upload the Team Operation Sheet (.xlsx). check=1 counts everything without saving."""
    permission_classes = [IsTeamAdmin]
    parser_classes = [MultiPartParser]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}, "check": {"type": "boolean"}}}},
                   responses=OpenApiTypes.OBJECT)
    def post(self, request):
        f = request.FILES.get("file")
        if not f or not f.name.lower().endswith(".xlsx"):
            raise ValidationError("Choose the Team Operation Sheet as an .xlsx file.")
        if f.size > 15 * 1024 * 1024:
            raise ValidationError("The file is larger than 15 MB.")
        try:
            report = import_workbook(f, request.user, dry_run=request.data.get("check") in ("1", "true", True),
                                     replace=request.data.get("replace") in ("1", "true", True))
        except WorkbookError as e:
            raise ValidationError(str(e))
        return Response(report)


class LeaderboardView(APIView):
    """This month's score so far, points this month and hours this week, for everyone with a work sheet."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        t = services.today()
        _, dash = services.dashboard_rows(t)
        _, perf = services.performance_rows(t.year, t)
        score = {r["id"]: r["months"][t.month - 1].get("score") for r in perf}
        rows = [{"id": r["id"], "person": r["person"] or r["name"], "role": r["role"], "score": score.get(r["id"]),
                 "points": r["month_points"], "hours": r["week_hours"], "ytd_points": r["ytd_points"]} for r in dash]
        return Response({"date": t, "rows": rows})


class ResetView(APIView):
    """Admins: delete all team data (every sheet, day and weekly KPI). The body must be {"confirm": "DELETE"}."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if request.data.get("confirm") != "DELETE":
            raise ValidationError('Type DELETE to confirm.')
        counts = services.delete_team_data()
        audit.log(request.user, "team.reset", "all team data", flagged=True, **counts)
        return Response(counts)


class WarningsView(APIView):
    permission_classes = [IsTeamAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"warnings": services.setup_warnings()})
