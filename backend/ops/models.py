from django.conf import settings
from django.db import models
from django.utils import timezone


class DigestLog(models.Model):
    """A weekly management digest that went out (SRS FR-TM4). One per week, so the weekly schedule can call as often
    as it likes and the digest still goes out once."""

    week_start = models.DateField(unique=True)
    sent_at = models.DateTimeField(default=timezone.now)
    recipients = models.JSONField(default=list)
    sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                                help_text="Empty = sent by the weekly schedule.")

    class Meta:
        ordering = ["-week_start"]

    def __str__(self):
        return f"Digest for the week of {self.week_start}"
