from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.views import health, media

urlpatterns = [
    path("django-admin/", admin.site.urls),   # not /admin/: the React app uses /admin/... for its own pages
    path("media/<path:name>", media, name="media"),
    path("api/health/", health, name="health"),
    path("api/", include("accounts.urls")),
    path("api/team/", include("team.urls")),
    path("api/tracker/", include("tracker.urls")),
    path("api/", include("core.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
