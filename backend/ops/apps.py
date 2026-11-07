from django.apps import AppConfig


class OpsConfig(AppConfig):
    """Team and management tools (SRS v0.3 §14.9): the morning huddle (FR-TM1) and the weekly digest (FR-TM4)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "ops"
    verbose_name = "Huddle and digest"
