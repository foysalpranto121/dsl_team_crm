from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("admin/users", views.AdminUserViewSet, basename="admin-users")

urlpatterns = [
    path("auth/google/", views.GoogleSignInView.as_view(), name="auth-google"),
    path("auth/refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/approval/<str:token>/", views.ApprovalLinkView.as_view(), name="approval-link"),
    path("me/", views.MeView.as_view(), name="me"),
    path("me/profile/", views.MyProfileView.as_view(), name="my-profile"),
    path("team/directory/", views.DirectoryView.as_view(), name="directory"),
] + router.urls
