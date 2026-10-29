from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("announcements", views.AnnouncementViewSet, basename="announcements")

urlpatterns = [
    path("admin/activity/", views.ActivityLogView.as_view(), name="activity-log"),
] + router.urls
