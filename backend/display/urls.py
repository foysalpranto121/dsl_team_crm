from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("screens", views.DisplayScreenViewSet, basename="display-screens")

urlpatterns = [
    path("feed/", views.FeedView.as_view(), name="display-feed"),
] + router.urls
