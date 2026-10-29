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
] + router.urls
