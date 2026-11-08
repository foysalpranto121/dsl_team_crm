from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="progress-me"),
    path("review/", views.ReviewView.as_view(), name="progress-review"),
    path("team-review/", views.TeamReviewView.as_view(), name="progress-team-review"),
    path("brief/", views.BriefView.as_view(), name="progress-brief"),
    path("records/<int:pk>/coach/", views.RecordCoachView.as_view(), name="progress-record-coach"),
]
