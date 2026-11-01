import mimetypes

from django.db.models import Q
from django.http import Http404, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminOrReadOnly, IsTeamAdmin
from team.services import today

from . import audit
from .models import Announcement, AuditLog, StoredFile

PAGE = 50


@require_GET
def health(request):
    """For uptime checks: answers without touching the database, so pinging it never wakes the database up."""
    return JsonResponse({"ok": True})


@require_GET
def media(request, name):
    """An uploaded file (profile photo) from the database. Names are random per upload, so they can be cached for good."""
    f = StoredFile.objects.filter(name=name).first()
    if f is None:
        raise Http404
    resp = HttpResponse(bytes(f.content), content_type=mimetypes.guess_type(name)[0] or "application/octet-stream")
    resp["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


class AuditSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "created_at", "actor", "action", "target", "detail", "flagged"]

    def get_actor(self, o):
        return {"name": o.actor.name or o.actor.email, "email": o.actor.email} if o.actor else None


class ActivityLogView(APIView):
    """Admins: every recorded change, newest first. ?flagged=1 shows only admin corrections to locked days."""
    permission_classes = [IsTeamAdmin]

    @extend_schema(parameters=[OpenApiParameter("flagged", bool), OpenApiParameter("action", str), OpenApiParameter("q", str),
                               OpenApiParameter("page", int)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        p = request.query_params
        qs = AuditLog.objects.select_related("actor")
        if p.get("flagged") in ("1", "true"):
            qs = qs.filter(flagged=True)
        if p.get("action"):
            qs = qs.filter(action__startswith=p["action"])
        if p.get("q"):
            qs = qs.filter(Q(target__icontains=p["q"]) | Q(actor__email__icontains=p["q"]) | Q(actor__name__icontains=p["q"]))
        try:
            page = max(1, int(p.get("page") or 1))
        except ValueError:
            page = 1
        rows = list(qs[(page - 1) * PAGE: page * PAGE + 1])
        return Response({"results": AuditSerializer(rows[:PAGE], many=True).data, "page": page, "has_more": len(rows) > PAGE,
                         "flagged_count": AuditLog.objects.filter(flagged=True).count()})


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ["id", "title", "body", "pinned", "expires_on", "created_by", "created_at"]
        read_only_fields = ["created_at"]

    def get_created_by(self, o):
        return (o.created_by.name or o.created_by.email) if o.created_by else None


class AnnouncementViewSet(viewsets.ModelViewSet):
    """Everyone sees current announcements; admins post, edit and remove them (?all=1 includes expired ones)."""
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = Announcement.objects.select_related("created_by")
        if self.request.query_params.get("all") == "1" and self.request.user.is_team_admin:
            return qs
        return qs.filter(Q(expires_on__isnull=True) | Q(expires_on__gte=today()))

    def perform_create(self, ser):
        a = ser.save(created_by=self.request.user)
        audit.log(self.request.user, "announcement.save", a.title)

    def perform_update(self, ser):
        a = ser.save()
        audit.log(self.request.user, "announcement.save", a.title)

    def perform_destroy(self, a):
        audit.log(self.request.user, "announcement.delete", a.title)
        a.delete()
