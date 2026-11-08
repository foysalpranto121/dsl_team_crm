from django.urls import path

from . import views

urlpatterns = [
    path("today/", views.TodayView.as_view(), name="playbook-today"),
    path("note/", views.NoteView.as_view(), name="playbook-note"),
    path("slot/", views.SlotView.as_view(), name="playbook-slot"),
    path("add-to-plan/", views.AddToPlanView.as_view(), name="playbook-add-to-plan"),
    path("let-go/", views.LetGoView.as_view(), name="playbook-let-go"),
    path("suggestions/<int:pk>/", views.SuggestionView.as_view(), name="playbook-suggestion"),
    path("history/", views.HistoryView.as_view(), name="playbook-history"),
]
