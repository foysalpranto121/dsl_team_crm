from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

Owner = settings.AUTH_USER_MODEL


class PipelineStage(models.Model):
    """The team's sales process (SRS v0.5 FR-K9). Records move through the open stages and end Won or Lost."""

    class Kind(models.TextChoices):
        OPEN = "open", "Open"
        WON = "won", "Won"
        LOST = "lost", "Lost"

    key = models.SlugField(max_length=20, unique=True)
    name = models.CharField(max_length=60)
    kind = models.CharField(max_length=4, choices=Kind.choices, default=Kind.OPEN)
    position = models.PositiveSmallIntegerField(default=0)
    expected_days = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(365)],
                                                     help_text="How many days a record usually stays here (deal health, FR-K10).")
    probability = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(100)])
    exit_criteria = models.CharField(max_length=300, blank=True, help_text="What must be true to move a record on.")
    value_required = models.BooleanField(default=False, help_text="A record needs an expected value to be in this stage (FR-K1).")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class KpiType(models.Model):
    """The weekly KPIs and the stage event each one counts (SRS v0.5 FR-C6, FR-K2): a record counts once per KPI, in the week
    it first reaches the bound stage."""

    class Key(models.TextChoices):
        LEADS = "leads", "Qualified leads"
        OPPS = "opps", "Opportunities"
        CLIENTS = "clients", "Clients"
        REVENUE = "revenue", "Revenue"

    key = models.CharField(max_length=10, choices=Key.choices, unique=True)
    name = models.CharField(max_length=60)
    definition = models.CharField(max_length=300, blank=True)
    stage = models.ForeignKey(PipelineStage, on_delete=models.PROTECT, related_name="kpi_types")
    verified_only = models.BooleanField(default=False, help_text="Count only wins a supervisor verified (work order received).")

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.name


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
    requirement = models.CharField(max_length=300, blank=True, help_text="What the client needs.")
    segment = models.CharField(max_length=80, blank=True, help_text="Segment or product, e.g. Tender, Corporate, SaaS.")
    stage = models.CharField(max_length=20, default="lead", db_index=True, help_text="A PipelineStage key.")
    stage_since = models.DateField(null=True, blank=True)
    value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)],
                                help_text="Expected value in the team's currency (FR-K8).")
    deal_currency = models.CharField(max_length=3, blank=True, help_text="Only if the deal is priced in another currency.")
    deal_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)])
    tender_deadline = models.DateField(null=True, blank=True)
    odoo_ref = models.CharField(max_length=300, blank=True, help_text="Odoo ID or link (FR-K6).")
    won_verified_at = models.DateTimeField(null=True, blank=True, help_text="A supervisor confirmed the work order (FR-K2).")
    won_verified_by = models.ForeignKey(Owner, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    win_loss_why = models.CharField(max_length=300, blank=True)
    win_loss_competitor = models.CharField(max_length=120, blank=True)
    win_loss_lesson = models.CharField(max_length=300, blank=True)
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


class StageEvent(models.Model):
    """A record's stage change (SRS v0.5 FR-K2). Weekly KPIs are counted from these, so nobody types counters."""

    class Review(models.TextChoices):
        NONE = "", "Not needed"
        FLAGGED = "flagged", "Needs review"
        OK = "ok", "Reviewed"

    record = models.ForeignKey(Prospect, on_delete=models.CASCADE, related_name="events")
    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="+", help_text="Whose KPIs the event counts for.")
    from_stage = models.CharField(max_length=20, blank=True)
    to_stage = models.CharField(max_length=20)
    day = models.DateField(db_index=True)
    backward = models.BooleanField(default=False)
    baseline = models.BooleanField(default=False, help_text="Imported at this stage: the stages up to here count as reached, but not as this "
                                                            "period's KPIs.")
    review = models.CharField(max_length=8, choices=Review.choices, default=Review.NONE, blank=True)
    review_note = models.CharField(max_length=300, blank=True)
    reviewed_by = models.ForeignKey(Owner, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    by = models.ForeignKey(Owner, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["day", "id"]
        indexes = [models.Index(fields=["owner", "day"])]


class ClientLogEntry(models.Model):
    """A record's timeline (SRS v0.5 FR-CL1): calls, emails, visits and notes, plus stage changes written automatically."""

    class Type(models.TextChoices):
        CALL = "call", "Call"
        EMAIL = "email", "Email"
        WHATSAPP = "whatsapp", "WhatsApp"
        VISIT = "visit", "Visit"
        MEETING = "meeting", "Meeting"
        NOTE = "note", "Note"
        STAGE = "stage", "Stage change"

    record = models.ForeignKey(Prospect, on_delete=models.CASCADE, related_name="log")
    type = models.CharField(max_length=10, choices=Type.choices)
    outcome = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=1000, blank=True)
    day = models.DateField()
    next_date = models.DateField(null=True, blank=True)
    by = models.ForeignKey(Owner, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-day", "-id"]
        verbose_name_plural = "client log entries"


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
