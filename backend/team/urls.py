from django.urls import path
from rest_framework.routers import DefaultRouter

from . import plan_views, views

router = DefaultRouter()
router.register("tasks", views.TaskViewSet, basename="team-tasks")
router.register("roles", views.JobRoleViewSet, basename="team-roles")
router.register("sheets", views.SheetViewSet, basename="team-sheets")

urlpatterns = [
    path("settings/", views.TeamSettingsView.as_view(), name="team-settings"),
    path("today/", views.TodayView.as_view(), name="team-today"),
    path("dashboard/", views.DashboardView.as_view(), name="team-dashboard"),
    path("performance/", views.PerformanceView.as_view(), name="team-performance"),
    path("warnings/", views.WarningsView.as_view(), name="team-warnings"),
    path("leaderboard/", views.LeaderboardView.as_view(), name="team-leaderboard"),
    path("reset/", views.ResetView.as_view(), name="team-reset"),
    path("import/", views.ImportView.as_view(), name="team-import"),
    path("export/", views.ExportView.as_view(), name="team-export"),
    path("kpi-week/", views.KpiWeekView.as_view(), name="team-kpi-week"),
    path("snapshots/", views.SnapshotView.as_view(), name="team-snapshots"),
    path("snapshots/<str:name>/", views.SnapshotFileView.as_view(), name="team-snapshot-file"),
    path("snapshots/<str:name>/restore/", views.SnapshotRestoreView.as_view(), name="team-snapshot-restore"),
    # Planning and approval: plan → submit → a supervisor approves → log against it (SRS v0.5 §5.2, §6)
    path("plans/week/", plan_views.PlanWeekView.as_view(), name="team-plan-week"),
    path("plans/action/", plan_views.PlanActionView.as_view(), name="team-plan-action"),
    path("plans/copy/", plan_views.PlanCopyView.as_view(), name="team-plan-copy"),
    path("plans/templates/", plan_views.PlanTemplatesView.as_view(), name="team-plan-templates"),
    path("plans/templates/<int:pk>/", plan_views.PlanTemplateView.as_view(), name="team-plan-template"),
    path("plans/history/", plan_views.PlanHistoryView.as_view(), name="team-plan-history"),
    path("plans/mine/", plan_views.PlanMineView.as_view(), name="team-plan-mine"),
    path("board/", plan_views.BoardView.as_view(), name="team-board"),
    path("board/decide/", plan_views.BoardDecideView.as_view(), name="team-board-decide"),
] + router.urls
