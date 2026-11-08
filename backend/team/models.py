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


def default_lost_reasons():
    return ["Price", "Chose a competitor", "No budget", "No decision", "Requirement changed", "Timing", "Lost the tender", "Other"]


class TeamSettings(models.Model):
    """One row. 'Today' and the midnight lock use this time zone, not the visitor's computer."""

    name = models.CharField(max_length=120, default="DSL Business Team")
    timezone = models.CharField(max_length=60, default="Asia/Dhaka", validators=[validate_timezone])
    lock_days = models.BooleanField(default=True, help_text="Members can only fill in today; past days lock at midnight.")
    week_start_dow = models.PositiveSmallIntegerField(choices=DAYS, default=6)
    weekend_days = models.JSONField(default=list, validators=[validate_days])
    count_weekend = models.BooleanField(default=True, help_text="Count hours logged on weekend days in totals.")

    # Approval policy (SRS v0.5 FR-C8, D1, FR-P6)
    class Unplanned(models.TextChoices):
        PROVISIONAL = "provisional", "Count provisionally; a supervisor can flag them later"
        STRICT = "strict", "Count zero until a supervisor approves them"

    class Cutoff(models.TextChoices):
        PREVIOUS_DAY = "previous_day", "By the end of the previous working day"
        SAME_DAY = "same_day", "Up to the day itself"

    unplanned_mode = models.CharField(max_length=12, choices=Unplanned.choices, default=Unplanned.PROVISIONAL,
                                      help_text="Hours logged without an approved plan (SRS D1, FR-T3).")
    plan_cutoff = models.CharField(max_length=12, choices=Cutoff.choices, default=Cutoff.PREVIOUS_DAY,
                                   help_text="Until when a day's plan can be made and submitted (SRS FR-P6).")

    # SRS v0.5 §0: only [MVP] features are on by default; these V2 features stay off until an admin switches them on.
    feature_tv = models.BooleanField(default=False, help_text="Office TV mode (V2).")
    feature_huddle = models.BooleanField(default=False, help_text="Morning huddle screen (V2).")
    feature_digest = models.BooleanField(default=False, help_text="Weekly management digest (V2).")
    feature_renewals = models.BooleanField(default=False, help_text="AMC and renewal tracker (V2).")

    # Weekly KPIs (SRS v0.5 FR-K2, FR-K5, FR-K7)
    class KpiMode(models.TextChoices):
        DERIVED = "derived", "Worked out from the pipeline"
        MANUAL = "manual", "Typed in each week (unevidenced; not recommended)"

    kpi_mode = models.CharField(max_length=8, choices=KpiMode.choices, default=KpiMode.DERIVED)
    kpi_from = models.DateField(null=True, blank=True, help_text="Weeks starting before this keep the numbers typed in. Empty = every week.")
    lost_reasons = models.JSONField(default=default_lost_reasons, blank=True)
    # Calendar and load handling (SRS v0.5 FR-C2, FR-SF5, FR-SF6, D6)
    holidays = models.JSONField(default=list, blank=True, help_text="Dates (YYYY-MM-DD) nobody works: framework steps skip them.")
    overload_items = models.PositiveSmallIntegerField(default=10, validators=[MinValueValidator(1), MaxValueValidator(500)],
                                                      help_text="A member is Overloaded with more open overdue items than this.")
    overload_days = models.PositiveSmallIntegerField(default=5, validators=[MinValueValidator(1), MaxValueValidator(60)],
                                                     help_text="Or when the oldest overdue item waited more working days than this.")
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
    counts_as_win = models.BooleanField(default=False, help_text="Logging this task is a win: it shows on the office TV and is celebrated.")

    class ScoringMode(models.TextChoices):
        """SRS v0.5 FR-C3, §7, D2: one slot × its points, or quantity × its points once a supervisor verified the event."""
        TIME = "time", "Per hour slot"
        EVENT = "event", "Per event, once verified"

    scoring_mode = models.CharField(max_length=5, choices=ScoringMode.choices, default=ScoringMode.TIME)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name

    @staticmethod
    def looks_like_win(name):
        """New tasks named like the workbook's "Client Work Order Receiving" count as wins unless an admin says otherwise."""
        return "work order" in (name or "").lower()


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


NOT_COUNTED = ("pending", "rejected", "flagged")


def slot_counts(slot, meta):
    """SRS v0.5 §6: a logged hour counts unless it was marked Not done, or it is waiting for approval (a deviation, or an
    unplanned hour in strict mode), was rejected, or was flagged by a supervisor."""
    if slot is None:
        return False
    m = meta or {}
    return m.get("status") != "not_done" and m.get("review") not in NOT_COUNTED


class SheetEntry(models.Model):
    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name="entries")
    day = models.DateField()
    slots = models.JSONField(default=list)          # up to 10 task ids (or null for an empty hour)
    # Work logs, per hour (SRS v0.5 FR-T1–T3): {status: done|partly|not_done, qty, ref, reason, planned: the approved
    # task at the time, review: None (counts) | pending | approved | rejected | flagged}. Empty for old entries and plans.
    meta = models.JSONField(default=list, blank=True)
    remarks = models.TextField(max_length=2000, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["sheet", "day"], name="one_entry_per_sheet_day")]
        indexes = [models.Index(fields=["day"])]
        ordering = ["day"]

    def meta_at(self, i):
        return self.meta[i] if self.meta and i < len(self.meta) and self.meta[i] else {}

    def counted_slots(self):
        """The hours that count for hours and points (output hours); the others become empty."""
        return [s if slot_counts(s, self.meta_at(i)) else None for i, s in enumerate(self.slots)]


class KpiEntry(models.Model):
    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name="kpis")
    week_start = models.DateField()
    leads = models.PositiveIntegerField(default=0)
    opps = models.PositiveIntegerField(default=0)
    clients = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    notes = models.TextField(max_length=2000, blank=True)
    counts_in = models.CharField(max_length=7, blank=True, help_text="Month this week counts in, as YYYY-MM. Empty = the month holding most of its days.")

    # SRS v0.5 FR-K2/K3: worked out from the pipeline, adjusted by a supervisor (with a note), confirmed by the member.
    class Source(models.TextChoices):
        TYPED = "typed", "Typed in"
        DERIVED = "derived", "From the pipeline"

    source = models.CharField(max_length=8, choices=Source.choices, default=Source.TYPED)
    derived = models.JSONField(default=dict, blank=True, help_text="What the pipeline gave, before adjustments.")
    adjust = models.JSONField(default=dict, blank=True, help_text="A supervisor's changes to the derived numbers: {metric: +/- amount}.")
    adjust_note = models.CharField(max_length=300, blank=True)
    adjusted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    adjusted_at = models.DateTimeField(null=True, blank=True)
    confirmed = models.JSONField(default=dict, blank=True, help_text="The numbers the member confirmed.")
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["sheet", "week_start"], name="one_kpi_per_sheet_week")]
        ordering = ["week_start"]


class WeekPlan(models.Model):
    """A person's plan for one week (SRS v0.5 §5.2, §6). Each planned hour has its own state: draft → submitted → approved
    or rejected (a rejected hour goes back to draft when the person changes it). The week's status follows from its hours:
    Draft, Submitted, Approved, Partially approved or Rejected; "In execution" and "Closed" follow from the dates.
    The planned tasks are the plan sheet's entries for those days. Kept for every week, so past weeks stay on record."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        PARTIAL = "partial", "Partially approved"
        REJECTED = "rejected", "Rejected"

    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name="week_plans", help_text="The person's plan sheet.")
    week_start = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    slot_states = models.JSONField(default=dict, blank=True)   # {"2026-11-08": [null | "submitted" | "approved" | "rejected", …]}
    goals = models.TextField(max_length=1000, blank=True, help_text="What the person wants to achieve this week.")
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    review_note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-week_start"]
        constraints = [models.UniqueConstraint(fields=["sheet", "week_start"], name="one_plan_per_sheet_week")]

    def __str__(self):
        return f"{self.sheet} · week of {self.week_start}"


class PlanTemplate(models.Model):
    """A reusable week of planned hours (SRS v0.5 FR-P4): the tasks of each weekday, by its place in the week (0–6)."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="plan_templates")
    name = models.CharField(max_length=80)
    days = models.JSONField(default=dict)            # {"0": [task ids…], "1": […], …}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["owner", "name"], name="one_template_name_per_owner")]

    def __str__(self):
        return self.name


class Backup(models.Model):
    """A copy of all team data taken before anything deletes it (see team.snapshots). Kept in the database so it survives server restarts."""

    name = models.CharField(max_length=120, unique=True)
    created = models.DateTimeField()
    reason = models.CharField(max_length=200)
    counts = models.JSONField(default=dict)
    data = models.JSONField()

    class Meta:
        ordering = ["-created", "-name"]

    def __str__(self):
        return self.name
