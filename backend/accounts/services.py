"""Google sign-in, the approval workflow and the emails that go with it."""
import logging

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.urls import reverse
from django.utils import timezone

from .models import User

log = logging.getLogger(__name__)
APPROVAL_SALT = "accounts.approval"


class SignInError(Exception):
    pass


# ---------- Google ----------

def verify_google_token(credential):
    """Check a Google ID token (from the Sign in with Google button) and return who it belongs to."""
    if not settings.GOOGLE_CLIENT_ID:
        raise SignInError("Google sign-in is not set up yet: add GOOGLE_CLIENT_ID to backend/.env.")
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    try:
        info = id_token.verify_oauth2_token(credential, g_requests.Request(), settings.GOOGLE_CLIENT_ID)
    except ValueError as e:
        raise SignInError("Google could not confirm this sign-in. Please try again.") from e
    if not info.get("email") or not info.get("email_verified"):
        raise SignInError("Your Google account has no verified email address.")
    domain = info["email"].rsplit("@", 1)[-1].lower()
    if settings.GOOGLE_ALLOWED_DOMAINS and domain not in settings.GOOGLE_ALLOWED_DOMAINS:
        raise SignInError("Please sign in with your company Google account.")
    return {"sub": info["sub"], "email": info["email"].lower(), "name": info.get("name", ""), "picture": info.get("picture", "")}


@transaction.atomic
def sign_in_with_google(info):
    """Find or create the person. New people wait for approval; ADMIN_EMAILS are approved as admin."""
    info = {**info, "email": info["email"].strip().lower()}
    user = User.objects.select_for_update().filter(google_sub=info["sub"]).first() \
        or User.objects.select_for_update().filter(email=info["email"]).first()
    created = user is None
    if created:
        user = User(email=info["email"])
    if user.google_sub and user.google_sub != info["sub"]:
        raise SignInError("This email is linked to a different Google account.")
    user.google_sub = info["sub"]
    user.name = user.name or info["name"]
    user.google_picture = info["picture"] or user.google_picture
    bootstrap_admin = info["email"] in settings.ADMIN_EMAILS and user.status == User.Status.PENDING
    if bootstrap_admin:
        user.status, user.role, user.approved_at = User.Status.APPROVED, User.Role.ADMIN, timezone.now()
    if created:
        user.set_unusable_password()
    user.save()
    if created and user.status == User.Status.PENDING:
        transaction.on_commit(lambda: notify_admins_of_request(user))
    return user, created


# ---------- approval ----------

def approval_token(user, action, admin):
    return signing.dumps({"u": user.pk, "a": action, "by": admin.pk}, salt=APPROVAL_SALT)


def read_approval_token(token):
    """Returns (user, action, admin) or raises signing.BadSignature / SignatureExpired."""
    data = signing.loads(token, salt=APPROVAL_SALT, max_age=settings.APPROVAL_LINK_MAX_AGE)
    if data.get("a") not in ("approve", "reject"):
        raise signing.BadSignature("unknown action")
    user = User.objects.filter(pk=data.get("u")).first()
    admin = User.objects.filter(pk=data.get("by")).first()
    if not user or not admin or not admin.is_team_admin:
        raise signing.BadSignature("user or admin no longer valid")
    return user, data["a"], admin


@transaction.atomic
def approve(user, by, role=User.Role.MEMBER):
    if role not in User.Role.values:
        raise ValueError("Unknown role")
    first_time = user.status != User.Status.APPROVED
    user.status, user.role, user.is_active = User.Status.APPROVED, role, True
    user.approved_by, user.approved_at = by, timezone.now()
    user.save(update_fields=["status", "role", "is_active", "approved_by", "approved_at"])
    if first_time:
        transaction.on_commit(lambda: notify_user_decision(user, approved=True))
    return user


@transaction.atomic
def reject(user, by):
    user.status, user.approved_by, user.approved_at = User.Status.REJECTED, by, timezone.now()
    user.save(update_fields=["status", "approved_by", "approved_at"])
    transaction.on_commit(lambda: notify_user_decision(user, approved=False))
    return user


# ---------- emails ----------

def _send(to, subject, text):
    try:
        send_mail(subject, text, settings.DEFAULT_FROM_EMAIL, to, fail_silently=False)
    except Exception:  # an email problem must never block sign-in; it is logged for the admin
        log.exception("Could not send email %r to %s", subject, to)


def notify_admins_of_request(user):
    admins = list(User.objects.filter(role=User.Role.ADMIN, status=User.Status.APPROVED, is_active=True))
    for admin in admins:
        link = lambda action: settings.BACKEND_URL + reverse("approval-link", args=[approval_token(user, action, admin)])
        _send([admin.email], f"Access request: {user.name or user.email}",
              f"Hi {admin.name or 'there'},\n\n{user.name or user.email} ({user.email}) asked for access to the DSL Business Team CRM.\n\n"
              f"Approve: {link('approve')}\nReject:  {link('reject')}\n\n"
              f"Each link opens a page where you confirm. They work for 7 days. You can also decide in the app under Admin → Approvals:\n"
              f"{settings.FRONTEND_URL}/admin/approvals\n")
    if not admins:
        log.warning("Access request from %s but there is no admin yet. Add your email to ADMIN_EMAILS.", user.email)


def notify_user_decision(user, approved):
    if approved:
        _send([user.email], "You now have access to the DSL Business Team CRM",
              f"Hi {user.name or 'there'},\n\nYour access was approved. Sign in with Google to finish setting up your profile:\n{settings.FRONTEND_URL}/login\n")
    else:
        _send([user.email], "Your access request to the DSL Business Team CRM",
              f"Hi {user.name or 'there'},\n\nYour access request was not approved. If you think this is a mistake, contact your team admin.\n")
