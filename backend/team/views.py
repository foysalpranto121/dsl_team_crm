from datetime import date, timedelta

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminOrReadOnly, IsApproved, IsTeamAdmin
from core import audit
from scoring import services as scoring
from scoring.models import EventLog
from scoring.serializers import EventSerializer

from . import calc, planning, services, snapshots
from .exporter import build_workbook
from .importer import WorkbookError, import_workbook
from .models import JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings
from .serializers import (EntrySerializer, EntryWriteSerializer, JobRoleSerializer, KpiAdjustSerializer, KpiSerializer, SheetSerializer, TaskSerializer,
                          TeamSettingsSerializer)

DAY = r"(?P<day>\d{4}-\d{2}-\d{2})"


def months_rates(frm, to):
    """{"2026-10": {task id: points}} for the months from frm to to: a past month's hours are worth what they were worth then."""
    book, out, ms = scoring.Book(), {}, calc.month_start(frm)
    while ms <= to:
        out[f"{ms:%Y-%m}"] = book.rates(ms)
        ms = calc.add_months(ms, 1)
    return out


def locked(e):
    return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)


def task_points():
    return {t.id: float(t.points) for t in Task.objects.all()}


def day_numbers(sheet, frm, to):
    """{day: {hours, points}} from the score ledger for a work log (SRS v0.5 FR-S1); None for a plan, which isn't scored."""
    if sheet.kind != Sheet.Kind.WORK:
        return None
    return {d: n for (_, d), n in scoring.day_totals([sheet.id], frm, to).items()}


class ConfigActor:
    """Configuration changes made through this view are versioned in this person's name (SRS v0.5 FR-C9)."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        scoring.set_actor(request.user)

    def finalize_response(self, request, response, *args, **kwargs):
        scoring.set_actor(None)
        return super().finalize_response(request, response, *args, **kwargs)


class TeamSettingsView(ConfigActor, APIView):
    permission_classes = [IsAdminOrReadOnly]

    @extend_schema(responses=TeamSettingsSerializer)
    def get(self, request):
        return Response(TeamSettingsSerializer(TeamSettings.load()).data)

    @extend_schema(request=TeamSettingsSerializer, responses=TeamSettingsSerializer)
    def patch(self, request):
        st = TeamSettings.load()
        before = (st.kpi_mode, st.kpi_from)
        ser = TeamSettingsSerializer(st, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        st = ser.save()
        audit.log(request.user, "settings.save", "team settings", **{k: str(v) for k, v in ser.validated_data.items()})
        if (st.kpi_mode, st.kpi_from) != before:   # SRS v0.5 FR-K5: switching the KPI mode or the cut-over works the weeks out again
            from tracker import kpis
            kpis.refresh_all(st)
        return Response(ser.data)


class TaskViewSet(ConfigActor, viewsets.ModelViewSet):
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
        if SheetEntry.objects.filter(slots__contains=[task.id]).exists() or EventLog.objects.filter(activity=task).exists():
            return Response({"detail": "This task is used in sheets. Switch it off instead, so past points stay correct."}, status=400)
        return super().destroy(request, *args, **kwargs)


class JobRoleViewSet(ConfigActor, viewsets.ModelViewSet):
    queryset = JobRole.objects.prefetch_related("tasks")
    serializer_class = JobRoleSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def perform_create(self, ser):
        audit.log(self.request.user, "role.save", ser.save().name)

    def perform_update(self, ser):
        r = ser.save()
        audit.log(self.request.user, "role.save", r.name, weights=r.weights, tasks=r.tasks.count())


class SheetViewSet(ConfigActor, viewsets.ModelViewSet):
    """Sheets: everyone sees them; admins create, rename, set targets and archive. Entries and weekly results are nested."""

    serializer_class = SheetSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = Sheet.objects.select_related("owner", "role")
        return qs if self.request.query_params.get("archived") == "1" else qs.filter(archived=False)

    def get_permissions(self):
        if self.action in ("entry", "kpi", "kpi_confirm", "kpi_adjust", "kpi_evidence"):   # members write here too; the services decide
            return [IsApproved()]
        return super().get_permissions()

    def perform_destroy(self, sheet):
        snapshots.take(f"before deleting {sheet.name}", self.request.user)
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
        plans = services.plan_statuses(sheet, frm, to, services.cfg_of(st))   # one query for every week in the range
        editable, blocked, d = {}, {}, frm
        while d <= to:   # which days this person may change, by the server's clock, and why not
            reason = services.entry_block(request.user, sheet, d, st, plans)
            editable[d.isoformat()] = reason is None
            if reason:
                blocked[d.isoformat()] = reason
            d += timedelta(days=1)
        return Response({"from": frm, "to": to, "today": t, "editable": editable, "blocked": blocked,
                         "entries": EntrySerializer(rows, many=True, context={"pts": task_points(), "ledger": day_numbers(sheet, frm, to)}).data,
                         # SRS v0.5 §7, D2: what each activity is worth in these months, and the events logged on these days
                         "rates": months_rates(frm, to) if sheet.kind == Sheet.Kind.WORK else {},
                         "events": EventSerializer(sheet.events.filter(day__range=(frm, to)).select_related("sheet", "activity", "decided_by", "record"), many=True,
                                                   context={"request": request}).data,
                         "plan_weeks": {str(k): v for k, v in plans.items()},
                         # the approved task of each hour, so the log can show the plan and pre-fill it (SRS v0.5 FR-T7)
                         "planned": {str(k): v for k, v in planning.approved_plans(sheet, frm, to, services.cfg_of(st)).items()}
                         if sheet.kind == Sheet.Kind.WORK else {},
                         "unplanned_mode": st.unplanned_mode,
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
            e = services.save_entry(request.user, sheet, d, ser.validated_data["slots"], ser.validated_data.get("remarks"), ser.validated_data.get("meta"))
        except services.Locked as err:
            return locked(err)
        if e is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(EntrySerializer(e, context={"pts": task_points(), "ledger": day_numbers(sheet, d, d)}).data)

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

    def _kpi_week(self, day):
        st = TeamSettings.load()
        try:
            return calc.week_start_of(services.parse_day(day), services.cfg_of(st))
        except services.Locked as e:
            raise ValidationError(str(e))

    @extend_schema(request=None, responses=KpiSerializer)
    @action(detail=True, methods=["post"], url_path=f"kpis/{DAY}/confirm")
    def kpi_confirm(self, request, pk=None, day=None):
        """SRS v0.5 FR-K3: the member confirms the week's numbers worked out from the pipeline."""
        from tracker import kpis
        try:
            k = kpis.confirm(request.user, self.get_object(), self._kpi_week(day))
        except kpis.KpiError as err:
            return locked(err)
        return Response(KpiSerializer(k).data)

    @extend_schema(request=KpiAdjustSerializer, responses=KpiSerializer)
    @action(detail=True, methods=["post"], url_path=f"kpis/{DAY}/adjust")
    def kpi_adjust(self, request, pk=None, day=None):
        """SRS v0.5 FR-K2: a supervisor sets the week's final numbers, with a note (audit-logged)."""
        from tracker import kpis
        ser = KpiAdjustSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = dict(ser.validated_data)
        note = d.pop("note")
        try:
            k = kpis.adjust(request.user, self.get_object(), self._kpi_week(day), d, note)
        except kpis.KpiError as err:
            return locked(err)
        return Response(KpiSerializer(k).data)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"], url_path=f"kpis/{DAY}/evidence")
    def kpi_evidence(self, request, pk=None, day=None):
        """The pipeline records behind a week's numbers (SRS v0.5 §11: every number drills down to its records)."""
        from tracker import kpis
        sheet, u = self.get_object(), request.user
        if not (sheet.owner_id == u.pk or u.can_approve or u.role == "viewer"):
            raise PermissionDenied("Only the person, supervisors and management see the records behind someone's numbers.")
        if not sheet.owner_id:
            return Response({"counted": {m: [] for m in kpis.METRICS}, "waiting": []})
        return Response(kpis.evidence(sheet.owner_id, self._kpi_week(day)))


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


def seen_from(request, t):
    """?month=2026-10 looks at a past month as it ended; ?date= at any day; neither = today.
    Returns the day and whether it closes a finished month."""
    p = request.query_params
    try:
        if p.get("month"):
            on = services.month_day(p["month"], t)
            return on, on < t
        return services.parse_day(p.get("date"), t), False
    except services.Locked as e:
        raise ValidationError(str(e))


class DashboardView(APIView):
    @extend_schema(parameters=[OpenApiParameter("month", str), OpenApiParameter("date", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        t = services.today()
        on, rows = services.dashboard_rows(*seen_from(request, t))
        # Admins see every person's gaps; everyone else sees only their own. Gaps are always as of today.
        owner = None if request.user.role == User.Role.ADMIN else request.user.pk
        return Response({"date": on, "month": f"{on:%Y-%m}", "current_month": f"{t:%Y-%m}", "rows": rows, "gaps": services.missing_results(t, owner)})


class PerformanceView(APIView):
    @extend_schema(parameters=[OpenApiParameter("year", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        t = services.today()
        year = int(request.query_params.get("year") or t.year)
        on, rows = services.performance_rows(year, t)
        return Response({"year": year, "date": on, "rows": rows, "team": calc.team_row(rows) if rows else None})


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
        renewed = services.renewal_revenue(cfg)
        rows = []
        for s in sheets:
            reason = services.kpi_block(request.user, s, ws, st)
            rows.append({"sheet": s.id, "name": s.name, "person": s.person or (s.owner.name if s.owner else s.name), "role": s.role.name if s.role else None,
                         "mine": s.owner_id == request.user.pk, "editable": reason is None, "blocked": reason, "has_owner": s.owner_id is not None,
                         "kpi": KpiSerializer(kpis[s.id]).data if s.id in kpis else None,
                         "renewals": renewed.get((s.id, ws), 0),   # added to the revenue typed in (renewal tracker, SRS FR-RN4)
                         "targets": {"leads": float(s.target_leads), "opps": float(s.target_opps), "clients": float(s.target_clients), "revenue": float(s.target_revenue)}})
        year, month = calc.month_of_week(ws)
        return Response({"week_start": ws, "week_end": ws + timedelta(days=6), "week_no": calc.week_no(ws, cfg)[0], "today": t,
                         "current_week_start": calc.week_start_of(t, cfg), "counts_in_month": f"{year}-{month:02d}", "rows": rows,
                         # SRS v0.5 FR-K2/K5: worked out from the pipeline, or typed (manual mode, or a week before the cut-over)
                         "derived": services.kpi_derived(st, ws), "kpi_mode": st.kpi_mode, "kpi_from": st.kpi_from,
                         "can_adjust": request.user.can_approve})


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
    """A month's score, points that month and hours in its last week (this month so far by default), for everyone with a work sheet."""

    @extend_schema(parameters=[OpenApiParameter("month", str)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        t = services.today()
        on, finished = seen_from(request, t)
        _, dash = services.dashboard_rows(on, finished)
        _, perf = services.performance_rows(on.year, on)
        score = {r["id"]: r["months"][on.month - 1].get("score") for r in perf}
        rows = [{"id": r["id"], "person": r["person"] or r["name"], "role": r["role"], "score": score.get(r["id"]),
                 "points": r["month_points"], "hours": r["week_hours"], "ytd_points": r["ytd_points"]} for r in dash]
        return Response({"date": on, "month": f"{on:%Y-%m}", "current_month": f"{t:%Y-%m}", "rows": rows})


class ResetView(APIView):
    """Admins: delete all team data (every sheet, day and weekly KPI). The body must be {"confirm": "DELETE"}."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if request.data.get("confirm") != "DELETE":
            raise ValidationError('Type DELETE to confirm.')
        backup = snapshots.take("before deleting all team data", request.user)
        counts = services.delete_team_data()
        audit.log(request.user, "team.reset", "all team data", flagged=True, **counts)
        return Response({**counts, "backup": backup})


class WarningsView(APIView):
    permission_classes = [IsTeamAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"warnings": services.setup_warnings()})


class SnapshotView(APIView):
    """Admins: the automatic and manual backups of team data, newest first. POST takes a backup now."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(snapshots.list_backups())

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return Response({"name": snapshots.take("manual backup", request.user)}, status=status.HTTP_201_CREATED)


class SnapshotFileView(APIView):
    """Admins: download one backup as a JSON file."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(responses={(200, "application/json"): OpenApiTypes.BINARY})
    def get(self, request, name):
        try:
            data = snapshots.read(name)
        except FileNotFoundError:
            raise NotFound("There is no backup with that name.")
        resp = HttpResponse(data, content_type="application/json")
        resp["Content-Disposition"] = f'attachment; filename="{name}"'
        return resp


class SnapshotRestoreView(APIView):
    """Admins: replace all team data with a backup. The body must be {"confirm": "RESTORE"}."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, name):
        if request.data.get("confirm") != "RESTORE":
            raise ValidationError("Type RESTORE to confirm.")
        try:
            return Response(snapshots.restore(name, request.user))
        except FileNotFoundError:
            raise NotFound("There is no backup with that name.")
        except ValueError as e:
            raise ValidationError(str(e))
