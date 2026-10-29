from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("prospects", views.ProspectViewSet, basename="tracker-prospects")
router.register("activities", views.ActivityViewSet, basename="tracker-activities")

urlpatterns = [
    path("settings/", views.SettingsView.as_view(), name="tracker-settings"),
    path("summary/", views.SummaryView.as_view(), name="tracker-summary"),
    path("plan/", views.PlanView.as_view(), name="tracker-plan"),
    path("plan/<str:day>/", views.PlanDayView.as_view(), name="tracker-plan-day"),
    path("import-backup/", views.BackupImportView.as_view(), name="tracker-import-backup"),
] + router.urls
