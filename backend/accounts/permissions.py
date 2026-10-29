from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsApproved(BasePermission):
    message = "You need an approved account."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_approved)


class IsTeamAdmin(BasePermission):
    message = "Only admins can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_team_admin)


class IsAdminOrReadOnly(BasePermission):
    """Everyone approved can read; only admins can change."""

    message = "Only admins can change this."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.is_approved):
            return False
        return request.method in SAFE_METHODS or request.user.is_team_admin
