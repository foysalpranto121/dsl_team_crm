"""SRS v0.5 §5.9 (data model §8): the Weekly Review. Ten minutes on the last working day: confirm the week's KPI counts and deal statuses, see the
recap, pick one focus, submit next week's plan. The numbers themselves stay where they live; this keeps the person's confirmations and focus."""
from django.conf import settings
from django.db import models


class WeeklyReview(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="weekly_reviews")
    week_start = models.DateField(db_index=True)
    deals_confirmed_at = models.DateTimeField(null=True, blank=True, help_text="FR-CL2: the week's status, compiled from the Client Log, confirmed in one tap.")
    focus = models.CharField(max_length=300, blank=True, help_text="FR-WR1: the one thing for next week.")
    recap = models.JSONField(default=dict, blank=True, help_text="The recap as it stood when the review was submitted.")
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-week_start"]
        constraints = [models.UniqueConstraint(fields=["owner", "week_start"], name="one_weekly_review_per_owner_week")]

    def __str__(self):
        return f"{self.owner} · week of {self.week_start}"
