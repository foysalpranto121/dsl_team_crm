from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


def user_can_sign_in(user):
    """Only approved, active people may get or use tokens."""
    return user is not None and user.is_approved


class ApprovedJWTAuthentication(JWTAuthentication):
    """A token stops working as soon as someone is disabled or loses approval, not only when it expires."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not user_can_sign_in(user):
            raise AuthenticationFailed("Your access has been removed. Contact an admin.", code="not_approved")
        return user


try:  # describe the JWT login in the API docs (/api/docs/)
    from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme

    class ApprovedJWTScheme(SimpleJWTScheme):
        target_class = "accounts.authentication.ApprovedJWTAuthentication"
        name = "jwtAuth"
except ImportError:  # pragma: no cover
    pass
