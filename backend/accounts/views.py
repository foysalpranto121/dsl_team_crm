from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.core import signing
from django.shortcuts import render
from django.views import View
from drf_spectacular.utils import extend_schema
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from . import services
from .authentication import user_can_sign_in
from .models import User
from .permissions import IsTeamAdmin
from .serializers import AdminUserSerializer, DecisionSerializer, GoogleSignInSerializer, MeSerializer, ProfileSerializer, UserSerializer

COOKIE = settings.REFRESH_COOKIE


def _with_tokens(response, user):
    """Issue a fresh access token in the body and a refresh token in an httpOnly cookie."""
    refresh = RefreshToken.for_user(user)
    response.data["access"] = str(refresh.access_token)
    response.set_cookie(COOKIE["key"], str(refresh), max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
                        path=COOKIE["path"], httponly=COOKIE["httponly"], samesite=COOKIE["samesite"], secure=COOKIE["secure"])
    return response


def _clear_cookie(response):
    response.delete_cookie(COOKIE["key"], path=COOKIE["path"], samesite=COOKIE["samesite"])
    return response


class AuthView(APIView):
    """Sign-in endpoints run before anyone has a token."""
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class GoogleSignInView(AuthView):
    @extend_schema(request=GoogleSignInSerializer, responses={200: dict})
    def post(self, request):
        ser = GoogleSignInSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            user, created = services.sign_in_with_google(services.verify_google_token(ser.validated_data["credential"]))
        except services.SignInError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        if not user.is_approved:
            state = User.Status.DISABLED if not user.is_active else user.status
            return Response({"status": state, "email": user.email, "name": user.name, "new_request": created})
        update_last_login(None, user)
        data = {"status": "approved", "user": MeSerializer(user, context={"request": request}).data}
        return _with_tokens(Response(data), user)


class RefreshView(AuthView):
    @extend_schema(request=None, responses={200: dict})
    def post(self, request):
        raw = request.COOKIES.get(COOKIE["key"])
        if not raw:
            return Response({"detail": "Not signed in."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            old = RefreshToken(raw)  # also refuses blacklisted tokens
        except TokenError:
            return _clear_cookie(Response({"detail": "Your session has ended. Sign in again."}, status=status.HTTP_401_UNAUTHORIZED))
        user = User.objects.filter(pk=old.get(settings.SIMPLE_JWT.get("USER_ID_CLAIM", "user_id"))).first()
        old.blacklist()
        if not user_can_sign_in(user):
            return _clear_cookie(Response({"detail": "Your access has been removed. Contact an admin."}, status=status.HTTP_401_UNAUTHORIZED))
        return _with_tokens(Response({"user": MeSerializer(user, context={"request": request}).data}), user)


class LogoutView(AuthView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        raw = request.COOKIES.get(COOKIE["key"])
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        return _clear_cookie(Response(status=status.HTTP_204_NO_CONTENT))


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user


class MyProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user.profile


class DirectoryView(generics.ListAPIView):
    """Everyone on the team, with their profile card."""
    serializer_class = UserSerializer
    pagination_class = None

    def get_queryset(self):
        return User.objects.filter(status=User.Status.APPROVED, is_active=True).select_related("profile")


class AdminUserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Admins: see requests, approve or reject them, change roles, disable people."""
    serializer_class = AdminUserSerializer
    permission_classes = [IsTeamAdmin]
    http_method_names = ["get", "patch", "post"]

    def perform_update(self, ser):
        from core import audit
        before = {k: getattr(ser.instance, k) for k in ser.validated_data}
        user = ser.save()
        audit.log(self.request.user, "user.update", user.email, before=before, after={k: getattr(user, k) for k in ser.validated_data})

    def get_queryset(self):
        qs = User.objects.select_related("profile", "approved_by").order_by("-requested_at")
        s = self.request.query_params.get("status")
        return qs.filter(status=s) if s in User.Status.values else qs

    @extend_schema(request=DecisionSerializer, responses=AdminUserSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        ser = DecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = services.approve(self.get_object(), request.user, ser.validated_data["role"])
        return Response({**self.get_serializer(user).data, "linked_sheets": user.linked_sheets})

    @extend_schema(request=None, responses=AdminUserSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        target = self.get_object()
        if target.pk == request.user.pk:
            return Response({"detail": "You can't reject yourself."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(services.reject(target, request.user)).data)


class ApprovalLinkView(View):
    """The Approve / Reject links in the admin's email. Opening the link only shows a page;
    the decision is made by pressing the button, so email scanners that open links can't approve anyone."""

    template = "accounts/approval.html"

    def _context(self, token):
        try:
            user, act, admin = services.read_approval_token(token)
        except signing.SignatureExpired:
            return {"error": "This link has expired. Open the app and decide under Admin → Approvals."}
        except signing.BadSignature:
            return {"error": "This link isn't valid any more."}
        return {"person": user, "action": act, "admin": admin, "roles": User.Role.choices, "app_url": settings.FRONTEND_URL}

    def get(self, request, token):
        return render(request, self.template, self._context(token))

    def post(self, request, token):
        ctx = self._context(token)
        if "error" not in ctx:
            person = ctx["person"]
            if person.status != User.Status.PENDING:
                ctx["done"] = f"Already decided: {person.get_status_display().lower()}."
            elif ctx["action"] == "approve":
                role = request.POST.get("role", User.Role.MEMBER)
                services.approve(person, ctx["admin"], role if role in User.Role.values else User.Role.MEMBER)
                ctx["done"] = f"{person} is approved as {person.get_role_display().lower()} and has been emailed."
            else:
                services.reject(person, ctx["admin"])
                ctx["done"] = f"{person}'s request was rejected."
        return render(request, self.template, ctx)
