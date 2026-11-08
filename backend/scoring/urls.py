from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("events", views.EventViewSet, basename="score-events")

urlpatterns = [
    path("ledger/", views.LedgerView.as_view(), name="score-ledger"),
    path("versions/", views.VersionsView.as_view(), name="score-versions"),
    path("recalculate/preview/", views.RecalculatePreviewView.as_view(), name="score-recalculate-preview"),
    path("recalculate/", views.RecalculateView.as_view(), name="score-recalculate"),
] + router.urls
