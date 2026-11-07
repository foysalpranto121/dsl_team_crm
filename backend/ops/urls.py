from django.urls import path

from . import views

urlpatterns = [
    path("huddle/", views.HuddleView.as_view(), name="ops-huddle"),
    path("huddle/focus/", views.HuddleFocusView.as_view(), name="ops-huddle-focus"),
    path("digest/", views.DigestView.as_view(), name="ops-digest"),
    path("digest/send/", views.DigestSendView.as_view(), name="ops-digest-send"),
    path("digest/run/", views.DigestRunView.as_view(), name="ops-digest-run"),
]
