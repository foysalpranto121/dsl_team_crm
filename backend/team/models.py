from decimal import Decimal
from zoneinfo import ZoneInfo, available_timezones

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

DAYS = [(0, "Sunday"), (1, "Monday"), (2, "Tuesday"), (3, "Wednesday"), (4, "Thursday"), (5, "Friday"), (6, "Saturday")]
METRICS = ("hours", "points", "leads", "opps", "clients", "revenue")
SLOTS = 10


def validate_timezone(value):
    if value not in available_timezones():
        raise ValidationError(f"Unknown time zone: {value}")


def validate_days(value):
    if not isinstance(value, list) or any(d not in range(7) for d in value):
        raise ValidationError("Use a list of day numbers 0 (Sunday) to 6 (Saturday).")


class TeamSettings(models.Model):
    """One row. 'Today' and the midnight lock use this time zone, not the visitor's computer."""

    name = models.CharField(max_length=120, default="DSL Business Team")
    timezone = models.CharField(max_length=60, default="Asia/Dhaka", validators=[validate_timezone])
    lock_days = models.BooleanField(default=True, help_text="Members can only fill in today; past days lock at midnight.")
    week_start_dow = models.PositiveSmallIntegerField(choices=DAYS, default=6)
    weekend_days = models.JSONField(default=list, validators=[validate_days])
    count_weekend = models.BooleanField(default=True, help_text="Count hours logged on weekend days in totals.")
    currency = models.CharField(max_length=8, default="BDT")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "team settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults={"weekend_days": [5]})
        return obj

    @property
    def zone(self):
        return ZoneInfo(self.timezone)


class Task(models.Model):
    """One thing that fills an hour slot, worth a number of points."""

    type = models.CharField(max_length=80, blank=True)
    name = models.CharField(max_length=120, unique=True)
    points = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("1"), validators=[MinValueValidator(0)])
    active = models.BooleanField(default=True, help_text="Inactive tasks disappear from dropdowns but keep counting in history.")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


def pct():
    return models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"), validators=[MinValueValidator(0), MaxValueValidator(100)])


class JobRole(models.Model):
    """Which tasks a person can pick, and how much each metric counts in their score (weights add up to 100)."""

    name = models.CharField(max_length=80, unique=True)
    tasks = models.ManyToManyField(Task, blank=True, related_name="roles")
    w_hours, w_points, w_leads, w_opps, w_clients, w_revenue = pct(), pct(), pct(), pct(), pct(), pct()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def weights(self):
        return {m: float(getattr(self, "w_" + m)) for m in METRICS}


def target(decimals=0, digits=8):
    return models.DecimalField(max_digits=digits, decimal_places=decimals, default=0, validators=[MinValueValidator(0)])


class Sheet(models.Model):
    """A person's daily work log (counts toward scores) or plan (doesn't). Admins name it and set its targets."""

    class Kind(models.TextChoices):
        WORK = "work", "Work log"
        PLAN = "plan", "Plan"

    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=4, choices=Kind.choices, default=Kind.WORK)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="sheets",
                              help_text="The person who fills it in. Empty = only admins can fill it in.")
    person = models.CharField(max_length=120, blank=True, help_text="Name shown on dashboards.")
    role = models.ForeignKey(JobRole, null=True, blank=True, on_delete=models.SET_NULL, related_name="sheets")
    target_hours = target(1, 5)        # per week
    target_points = target(1, 8)       # per month
    target_leads = target()            # per month
    target_opps = target()
    target_clients = target()
    target_revenue = target(2, 14)
    start_date = models.DateField(null=True, blank=True, help_text="Averages and scores count from this date.")
    position = models.PositiveIntegerField(default=0)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["archived", "position", "id"]

    def __str__(self):
        return self.name

    @property
    def targets(self):
        t = {m: float(getattr(self, "target_" + m)) for m in METRICS}
        t["start"] = self.start_date
        return t


class SheetEntry(models.Model):
    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name="entries")
    day = models.DateField()
    slots = models.JSONField(default=list)          # up to 10 task ids (or null for an empty hour)
    remarks = models.TextField(max_length=2000, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["sheet", "day"], name="one_entry_per_sheet_day")]
        indexes = [models.Index(fields=["day"])]
        ordering = ["day"]


class KpiEntry(models.Model):
    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name="kpis")
    week_start = models.DateField()
    leads = models.PositiveIntegerField(default=0)
    opps = models.PositiveIntegerField(default=0)
    clients = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    notes = models.TextField(max_length=2000, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["sheet", "week_start"], name="one_kpi_per_sheet_week")]
        ordering = ["week_start"]
