from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("prospects", views.ProspectViewSet, basename="tracker-prospects")
router.register("activities", views.ActivityViewSet, basename="tracker-activities")
router.register("stages", views.StageViewSet, basename="tracker-stages")
router.register("kpi-types", views.KpiTypeViewSet, basename="tracker-kpi-types")

urlpatterns = [
    path("settings/", views.SettingsView.as_view(), name="tracker-settings"),
    path("summary/", views.SummaryView.as_view(), name="tracker-summary"),
    path("plan/", views.PlanView.as_view(), name="tracker-plan"),
    path("plan/<str:day>/", views.PlanDayView.as_view(), name="tracker-plan-day"),
    path("import-backup/", views.BackupImportView.as_view(), name="tracker-import-backup"),
    path("team/", views.TeamPipelinesView.as_view(), name="tracker-team"),
    path("config/", views.ConfigView.as_view(), name="tracker-config"),
    path("reviews/", views.ReviewsView.as_view(), name="tracker-reviews"),
    path("reviews/moves/<int:pk>/", views.ReviewMoveView.as_view(), name="tracker-review-move"),
    path("reviews/wins/<int:pk>/", views.VerifyWinView.as_view(), name="tracker-verify-win"),
    path("kpis/recalculate/", views.RecalculateView.as_view(), name="tracker-kpi-recalculate"),
] + router.urls
