from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from .template import STAGES

Owner = settings.AUTH_USER_MODEL


class TrackerSettings(models.Model):
    """Each person's own product, period, targets, point rules and lists. Private to them."""

    class Template(models.TextChoices):
        BLANK = "blank", "Blank: only my own tasks"
        CENTRAL_AI = "centralai", "Central AI 30-day launch plan"

    owner = models.OneToOneField(Owner, on_delete=models.CASCADE, related_name="tracker_settings")
    product = models.CharField(max_length=80, blank=True)
    tagline = models.CharField(max_length=120, blank=True)
    period_start = models.DateField()
    period_days = models.PositiveSmallIntegerField(default=30, validators=[MinValueValidator(7), MaxValueValidator(120)])
    targets = models.JSONField(default=dict)        # {points, leads, opps, clients} for the whole period
    weeks = models.JSONField(default=list)          # [{leads, opps, clients, points, focus}] per week of the period
    rules = models.JSONField(default=dict)          # point rules: milestone and activity keys -> points
    lists = models.JSONField(default=dict)          # {countries, industries, channels, plans}
    plan_template = models.CharField(max_length=10, choices=Template.choices, default=Template.BLANK)
    share_with_admins = models.BooleanField(default=False, help_text="Let admins see this pipeline (read-only).")
    updated_at = models.DateTimeField(auto_now=True)


class Prospect(models.Model):
    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="prospects")
    company = models.CharField(max_length=200)
    website = models.CharField(max_length=200, blank=True)
    contact = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=150, blank=True)
    email = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=60, blank=True)
    linkedin = models.CharField(max_length=300, blank=True)
    country = models.CharField(max_length=80, blank=True)
    industry = models.CharField(max_length=80, blank=True)
    channel = models.CharField(max_length=60, blank=True)
    plan = models.CharField(max_length=60, blank=True)
    stage = models.CharField(max_length=10, choices=STAGES, default="prospect", db_index=True)
    last_contacted = models.DateField(null=True, blank=True)
    next_follow_up = models.DateField(null=True, blank=True, db_index=True)
    next_action = models.CharField(max_length=200, blank=True)
    lead_date = models.DateField(null=True, blank=True)
    opp_date = models.DateField(null=True, blank=True)
    client_date = models.DateField(null=True, blank=True)
    lost_reason = models.CharField(max_length=200, blank=True)
    notes = models.TextField(max_length=5000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["next_follow_up", "-updated_at"]
        indexes = [models.Index(fields=["owner", "stage"])]

    def __str__(self):
        return self.company


class Activity(models.Model):
    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="activities")
    date = models.DateField(db_index=True)
    type = models.CharField(max_length=20)
    qty = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(100000)])
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name_plural = "activities"


class PlanDay(models.Model):
    """A day of the personal plan. Only stored once the person changes it; until then the template's tasks show."""

    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="plan_days")
    date = models.DateField()
    tasks = models.JSONField(default=list)          # [{id, text, done}]
    note = models.TextField(max_length=2000, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "date"], name="one_plan_day_per_owner_date")]
