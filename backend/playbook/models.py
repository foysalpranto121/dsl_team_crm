"""The Daily Playbook (SRS v0.5 §5.8, data model §8): the member's home screen for the day.

The items are worked out live from their sources (the approved plan, framework steps, My Tasks, the pipeline), so they can't drift from
what's really open. PlaybookItem records each item seen today, by source type and ID, so the day ring keeps credit for what was finished
and a snapshot stays for trends (FR-DP4, FR-DP6). AiSuggestion keeps what the rules-based coach suggested, and what the member thought of
it (FR-AC1, FR-AC8).
"""
from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL


class PlaybookDay(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="playbook_days")
    day = models.DateField()
    opened_at = models.DateTimeField(null=True, blank=True, help_text="Start my day: the stopwatch runs from here (FR-DP10).")
    closed_at = models.DateTimeField(null=True, blank=True, help_text="Close my day: the stopwatch stops here, or at the end of the day.")
    note = models.TextField(max_length=2000, blank=True, help_text="The day note (FR-DP5).")
    snapshot = models.JSONField(default=dict, blank=True, help_text="The day's numbers as they last stood, kept for trends (FR-DP6).")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-day"]
        constraints = [models.UniqueConstraint(fields=["owner", "day"], name="one_playbook_per_owner_day")]

    def __str__(self):
        return f"{self.owner} {self.day}"


class PlaybookItem(models.Model):
    """One thing on a day's list, referencing its source by type and ID (§8)."""

    day = models.ForeignKey(PlaybookDay, on_delete=models.CASCADE, related_name="items")
    key = models.CharField(max_length=60, help_text="e.g. step:12, task:7, slot:3, lead:45.")
    group = models.CharField(max_length=8)
    source_type = models.CharField(max_length=12, blank=True)
    source_id = models.PositiveBigIntegerField(null=True, blank=True)
    title = models.CharField(max_length=240)
    detail = models.CharField(max_length=240, blank=True)
    to = models.CharField(max_length=200, blank=True)
    weight = models.PositiveSmallIntegerField(default=1)
    sticky = models.BooleanField(default=False, help_text="When it leaves the list it was dealt with, so it stays on the ring as done.")
    done_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True, help_text="Why it was let go, when it was.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [models.UniqueConstraint(fields=["day", "key"], name="one_playbook_item_per_day_key")]


class AiSuggestion(models.Model):
    """P5, FR-AC1: at most three a day, each with why (the evidence), one action, and Useful / Not useful. Rules-based; never changes a score."""

    class Feedback(models.TextChoices):
        NONE = "", "None"
        USEFUL = "useful", "Useful"
        NOT_USEFUL = "not_useful", "Not useful"

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="ai_suggestions")
    day = models.DateField(db_index=True)
    key = models.CharField(max_length=60)
    rule = models.CharField(max_length=20)
    title = models.CharField(max_length=240)
    why = models.CharField(max_length=400)
    record = models.ForeignKey("tracker.Prospect", null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    action = models.CharField(max_length=60, default="Open the record")
    rank = models.FloatField(default=0)
    feedback = models.CharField(max_length=10, choices=Feedback.choices, default=Feedback.NONE, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-rank", "id"]
        constraints = [models.UniqueConstraint(fields=["owner", "day", "key"], name="one_suggestion_per_owner_day_key")]
