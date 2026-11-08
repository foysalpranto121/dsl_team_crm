from django.apps import AppConfig


class ScoringConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "scoring"
    verbose_name = "Score ledger"

    def ready(self):
        from . import signals  # noqa: F401  (connects the receivers)
