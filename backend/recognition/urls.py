from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="recognition-me"),
    path("feed/", views.FeedView.as_view(), name="recognition-feed"),
    path("feed/<int:pk>/react/", views.ReactView.as_view(), name="recognition-react"),
    path("celebrate/", views.CelebrateView.as_view(), name="recognition-celebrate"),
    path("thanks/", views.ThanksView.as_view(), name="recognition-thanks"),
    path("leave/", views.LeaveView.as_view(), name="recognition-leave"),
    path("leave/<int:pk>/", views.LeaveDayView.as_view(), name="recognition-leave-day"),
]
