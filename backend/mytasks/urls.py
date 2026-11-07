from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("items", views.TaskViewSet, basename="my-tasks")

urlpatterns = [
    path("when/", views.WhenView.as_view(), name="my-tasks-when"),
    path("assign/", views.AssignView.as_view(), name="my-tasks-assign"),
    path("team/", views.TeamView.as_view(), name="my-tasks-team"),
] + router.urls
