from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsTeamAdmin
from core import audit
from core.features import gate

from . import services
from .authentication import DisplayTokenAuthentication, IsDisplayScreen
from .models import DisplayScreen
from .serializers import DisplayScreenSerializer


class DisplayScreenViewSet(gate("tv"), viewsets.ModelViewSet):
    """Admins manage the TV screens. A screen's link (with its secret token) is returned only when the screen is created
    or its link is replaced; after that only the first characters (token_hint) are shown."""

    queryset = DisplayScreen.objects.select_related("created_by")
    serializer_class = DisplayScreenSerializer
    permission_classes = [IsTeamAdmin]
    pagination_class = None

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        screen = ser.save(created_by=request.user)
        audit.log(request.user, "display.create", screen.name)
        return Response({**self.get_serializer(screen).data, "token": screen.raw_token}, status=status.HTTP_201_CREATED)

    def perform_update(self, ser):
        before = {k: str(getattr(ser.instance, k)) for k in ser.validated_data}
        screen = ser.save()
        audit.log(self.request.user, "display.update", screen.name, before=before, after={k: str(v) for k, v in ser.validated_data.items()})

    def perform_destroy(self, screen):
        audit.log(self.request.user, "display.delete", screen.name)
        screen.delete()

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def rotate(self, request, pk=None):
        """A new link for this screen. The old link stops working at once (e.g. after a TV is moved or a link was shared)."""
        screen = self.get_object()
        token = screen.issue_token()
        screen.last_seen_at = None   # the TV is disconnected until the new link is opened on it
        screen.save(update_fields=["token_hash", "token_hint", "last_seen_at", "updated_at"])
        audit.log(request.user, "display.rotate", screen.name)
        return Response({**self.get_serializer(screen).data, "token": token})


class FeedView(gate("tv"), APIView):
    """Everything one TV shows, read-only. Signed in with the screen's token, never with a person's account."""

    authentication_classes = [DisplayTokenAuthentication]
    permission_classes = [IsDisplayScreen]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "display"

    @extend_schema(parameters=[OpenApiParameter("X-Display-Token", str, OpenApiParameter.HEADER, required=True)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        screen = request.auth
        screen.touch()
        return Response(services.feed(screen))
