from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Who changed what, and when. Admin edits to locked days are flagged so they stand out."""

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=60)
    target = models.CharField(max_length=200, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    flagged = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor} {self.action} {self.target}"
