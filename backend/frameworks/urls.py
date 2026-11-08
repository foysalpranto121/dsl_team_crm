from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("steps", views.StepViewSet, basename="framework-steps")
router.register("items", views.FrameworkViewSet, basename="frameworks")

urlpatterns = [
    path("packs/", views.PacksView.as_view(), name="framework-packs"),
    path("records/<int:pk>/", views.RecordView.as_view(), name="framework-record"),
    path("records/<int:pk>/pick/", views.PickView.as_view(), name="framework-pick"),
    path("load/", views.LoadView.as_view(), name="framework-load"),
    path("load/me/", views.MyLoadView.as_view(), name="framework-my-load"),
    path("load/<int:pk>/override/", views.OverrideView.as_view(), name="framework-override"),
    path("reviews/<int:pk>/", views.StageReviewView.as_view(), name="framework-stage-review"),
] + router.urls
