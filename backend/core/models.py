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


class Announcement(models.Model):
    """A message from an admin shown on everyone's dashboard until it expires (or forever if no end date)."""

    title = models.CharField(max_length=140)
    body = models.TextField(max_length=3000, blank=True)
    pinned = models.BooleanField(default=False)
    expires_on = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-pinned", "-created_at"]

    def __str__(self):
        return self.title
