import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

# What a screen can show (SRS FR-TV2). "challenge" and "tenders" join when those features exist.
PANELS = ("progress", "wins", "leaders")


def default_panels():
    return list(PANELS)


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class DisplayScreen(models.Model):
    """A TV on the sales floor (SRS FR-TV1). It signs in with its own display-only token, which can read this screen's
    feed and nothing else. Only a hash of the token is kept: admins see the link once, and can replace it."""

    class Leaders(models.TextChoices):
        TOP = "top", "Top performers"
        IMPROVERS = "improvers", "Top improvers"
        OFF = "off", "Hidden"

    name = models.CharField(max_length=80)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    token_hint = models.CharField(max_length=8, editable=False, help_text="First characters of the link, to tell links apart.")
    panels = models.JSONField(default=default_panels)
    rotate_seconds = models.PositiveSmallIntegerField(default=20, validators=[MinValueValidator(8), MaxValueValidator(120)])
    leaders = models.CharField(max_length=10, choices=Leaders.choices, default=Leaders.TOP)
    leaders_count = models.PositiveSmallIntegerField(default=3, validators=[MinValueValidator(1), MaxValueValidator(5)])
    show_values = models.BooleanField(default=False, help_text="Show win details (client, amounts) and the revenue figure.")
    celebrate = models.BooleanField(default=True, help_text="Full-screen celebration when a new win is logged today.")
    sound = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name

    def issue_token(self):
        """A new secret for the screen's link. Keeps only its hash and returns the token, to show the admin once."""
        raw = secrets.token_urlsafe(32)
        self.token_hash, self.token_hint = hash_token(raw), raw[:6]
        return raw

    def touch(self):
        """Remember when the TV last asked for data (written at most once a minute, without changing updated_at)."""
        now = timezone.now()
        if not self.last_seen_at or now - self.last_seen_at > timedelta(seconds=60):
            DisplayScreen.objects.filter(pk=self.pk).update(last_seen_at=now)
            self.last_seen_at = now
