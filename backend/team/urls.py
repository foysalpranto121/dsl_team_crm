from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

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
] + router.urls
