from django.contrib.auth.models import AnonymousUser
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import DisplayScreen, hash_token


class DisplayTokenAuthentication(BaseAuthentication):
    """A TV signs in with its screen's token in the X-Display-Token header (the page keeps it in the URL #fragment,
    which browsers never send to a server, so it stays out of access logs). request.auth becomes the screen."""

    def authenticate(self, request):
        raw = request.META.get("HTTP_X_DISPLAY_TOKEN", "").strip()
        if not raw:
            return None
        screen = DisplayScreen.objects.filter(token_hash=hash_token(raw), active=True).first()
        if screen is None:
            raise AuthenticationFailed("This screen's link was turned off or replaced. Ask an admin for the new link.")
        return AnonymousUser(), screen

    def authenticate_header(self, request):
        return "Display"   # so a missing or wrong token answers 401, not 403


class IsDisplayScreen(BasePermission):
    message = "Open this page with a TV screen link."

    def has_permission(self, request, view):
        return isinstance(request.auth, DisplayScreen)
