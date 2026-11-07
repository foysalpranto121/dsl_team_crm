from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("contracts", views.ContractViewSet, basename="renewal-contracts")
router.register("opportunities", views.RenewalViewSet, basename="renewal-opportunities")

urlpatterns = [
    path("summary/", views.SummaryView.as_view(), name="renewal-summary"),
    path("due/", views.DueView.as_view(), name="renewal-due"),
    path("settings/", views.SettingsView.as_view(), name="renewal-settings"),
] + router.urls
