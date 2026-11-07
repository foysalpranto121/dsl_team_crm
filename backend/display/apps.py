from django.apps import AppConfig


class DisplayConfig(AppConfig):
    """Office TV mode (SRS v0.3 §14.5): read-only screens for the sales floor."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "display"
    verbose_name = "TV screens"
