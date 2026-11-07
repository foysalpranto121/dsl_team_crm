import logging

from django.conf import settings
from django.utils.crypto import constant_time_compare
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsTeamAdmin
from core.features import gate
from team import calc
from team import services as team
from team.models import TeamSettings

from . import services
from .models import DigestLog

logger = logging.getLogger(__name__)


class IsAdminOrManagement(BasePermission):
    message = "Only admins and management can see the weekly digest."

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_approved and u.role in ("admin", "viewer"))


def _week(value):
    """The start of the chosen finished week (default: last week). Weeks still running can't be chosen."""
    st = TeamSettings.load()
    cfg = team.cfg_of(st)
    latest = services.last_full_week(team.today(st), cfg)
    try:
        ws = calc.week_start_of(team.parse_day(value, latest), cfg)
    except team.Locked as e:
        raise ValidationError(str(e))
    if ws > latest:
        raise ValidationError("That week isn't over yet. The digest covers finished weeks.")
    return ws, latest


def _sent(log):
    if log is None:
        return None
    return {"week_start": log.week_start, "at": log.sent_at, "recipients": log.recipients,
            "by": (log.sent_by.name or log.sent_by.email) if log.sent_by else None}


class HuddleView(gate("huddle"), APIView):
    """The morning huddle (SRS FR-TM1). Admins also see names of missing results, stuck deals and people waiting for approval."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(services.huddle(request.user))


class FocusSerializer(serializers.Serializer):
    text = serializers.CharField(min_length=3, max_length=300)


class HuddleFocusView(gate("huddle"), APIView):
    """Post the huddle's one focus for today. It becomes a pinned announcement on everyone's dashboard until midnight."""

    permission_classes = [IsTeamAdmin]

    @extend_schema(request=FocusSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = FocusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        a = services.set_focus(request.user, ser.validated_data["text"])
        return Response({"text": a.body, "by": request.user.name or request.user.email, "at": a.created_at}, status=status.HTTP_201_CREATED)


class DigestView(gate("digest"), APIView):
    """One week's management digest (SRS FR-TM4): the email exactly as it is sent, its numbers, recipients and send history."""

    permission_classes = [IsAdminOrManagement]

    @extend_schema(parameters=[OpenApiParameter("week", str, description="Any day in the week; default: last week")], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        ws, latest = _week(request.query_params.get("week"))
        data = services.digest(ws)
        subject, _, html = services.render(data)
        return Response({
            "week_start": ws, "latest_week": latest, "subject": subject, "html": html, "recipients": services.recipients(),
            "sent": _sent(DigestLog.objects.filter(week_start=ws).select_related("sent_by").first()),
            "history": [_sent(x) for x in DigestLog.objects.select_related("sent_by")[:12]],
            "automatic": bool(settings.DIGEST_CRON_SECRET),
            "data": data,
        })


class DigestSendView(gate("digest"), APIView):
    """Admins send a week's digest now. A week that already went out needs force=true ("Send again")."""

    permission_classes = [IsTeamAdmin]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ws, _ = _week(request.data.get("week"))
        force = request.data.get("force") in (True, "true", "1", 1)
        try:
            sent = services.send_digest(ws, by=request.user, force=force)
        except services.AlreadySent:
            return Response({"detail": "This week's digest was already sent. Choose “Send again” to send it once more."}, status=status.HTTP_409_CONFLICT)
        except services.NoRecipients as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:   # the mail service failed: say so plainly, keep the details in the server log
            logger.exception("Could not send the weekly digest for %s", ws)
            return Response({"detail": "The email couldn't be sent. Check the email settings (BREVO_API_KEY or Gmail) and try again."},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response({"sent": _sent(sent)})


class DigestRunView(gate("digest"), APIView):
    """For the weekly schedule, e.g. a cron-job.org job: POST with the header X-Cron-Secret: <DIGEST_CRON_SECRET>.
    Sends last week's digest if it hasn't gone out yet, so calling it more than once is harmless. No secret set = off."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "cron"

    @extend_schema(request=None, parameters=[OpenApiParameter("X-Cron-Secret", str, OpenApiParameter.HEADER, required=True)], responses=OpenApiTypes.OBJECT)
    def post(self, request):
        secret = settings.DIGEST_CRON_SECRET
        if not secret:
            return Response({"detail": "Automatic sending is off. Set DIGEST_CRON_SECRET on the server to turn it on."}, status=status.HTTP_404_NOT_FOUND)
        if not constant_time_compare(request.headers.get("X-Cron-Secret", ""), secret):
            return Response({"detail": "Wrong secret."}, status=status.HTTP_403_FORBIDDEN)
        try:
            sent, ws = services.run_scheduled()
        except services.NoRecipients as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("The scheduled weekly digest failed")
            return Response({"detail": "The email couldn't be sent. Check the email settings."}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"sent": sent is not None, "week_start": ws})
