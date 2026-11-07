from django.apps import AppConfig


class MyTasksConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mytasks"
    verbose_name = "My Tasks"
