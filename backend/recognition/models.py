"""Recognition (SRS v0.5 §5.11, data model §8): streaks, five fixed badges, win celebration and the win feed. It never changes the composite score
(§7, acceptance test 13), and each part can be switched off per team (NFR-10). Streaks are worked out from closed days and weekly hours each time,
so they can't drift; what's stored is what was awarded, posted and reacted to."""
from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL


class LeaveDay(models.Model):
    """A day off. Leave and holidays never break a streak (FR-MO2)."""

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="leave_days")
    day = models.DateField(db_index=True)
    reason = models.CharField(max_length=120, blank=True)
    by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["day"]
        constraints = [models.UniqueConstraint(fields=["owner", "day"], name="one_leave_per_owner_day")]


class BadgeAward(models.Model):
    """One of the five fixed badges (FR-MO3; recognition.services.BADGES), earned once."""

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="badges")
    badge = models.CharField(max_length=20)
    awarded_on = models.DateField()
    seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-awarded_on", "-id"]
        constraints = [models.UniqueConstraint(fields=["owner", "badge"], name="one_badge_per_owner")]


class FeedPost(models.Model):
    """FR-MO4, FR-MO5: a verified win, a badge, or a supervisor's word of thanks on the team's feed."""

    class Kind(models.TextChoices):
        WIN = "win", "Win"
        BADGE = "badge", "Badge"
        THANKS = "thanks", "Thanks"

    kind = models.CharField(max_length=6, choices=Kind.choices)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="feed_posts")
    day = models.DateField(db_index=True)
    record = models.ForeignKey("tracker.Prospect", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    event = models.ForeignKey("scoring.EventLog", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    badge = models.CharField(max_length=20, blank=True)
    company = models.CharField(max_length=200, blank=True)
    value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    what = models.CharField(max_length=200, blank=True)
    message = models.CharField(max_length=500, blank=True, help_text="The supervisor's message (FR-MO4).")
    by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    seen_at = models.DateTimeField(null=True, blank=True, help_text="The person has seen the celebration.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class FeedReaction(models.Model):
    """FR-MO5: one person's reaction to a post."""

    class Kind(models.TextChoices):
        CLAP = "clap", "Well done"
        PARTY = "party", "Celebrate"
        HEART = "heart", "Love it"

    post = models.ForeignKey(FeedPost, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=5, choices=Kind.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["post", "user", "kind"], name="one_reaction_per_post_user_kind")]
