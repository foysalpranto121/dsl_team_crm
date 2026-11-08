"""Keeps the ledger in step with what it's built from, whichever way the data changes (the API, the Django admin, a task or step
logging an hour). Bulk writers pause this and call services.adopt() when they finish."""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from team.models import JobRole, Sheet, SheetEntry, Task, TeamSettings

from . import services


@receiver(post_save, sender=SheetEntry)
def entry_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        services.sync_entry(instance)


@receiver(post_delete, sender=SheetEntry)
def entry_deleted(sender, instance, **kwargs):
    services.clear_entry(instance)


@receiver(post_save, sender=Sheet)
def sheet_saved(sender, instance, raw=False, created=False, **kwargs):
    if raw:
        return
    if not created:
        services.sync_owner(instance)
    services.sync_config()


@receiver([post_save], sender=Task)
@receiver([post_save], sender=JobRole)
@receiver([post_save], sender=TeamSettings)
def config_saved(sender, instance, raw=False, **kwargs):
    if not raw:
        services.sync_config()


@receiver([post_delete], sender=Task)
@receiver([post_delete], sender=JobRole)
@receiver([post_delete], sender=Sheet)
def config_deleted(sender, instance, **kwargs):
    services.sync_config()
