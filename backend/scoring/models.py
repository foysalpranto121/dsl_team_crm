"""The score ledger (SRS v0.5 §5.4, §7, data model §8).

Every counted hour slot or verified event writes one ScoreLedger row: member, date, activity, points, configuration version,
source (FR-S1). Hours and points on every screen are read from these rows, never typed and never worked out again from today's
task values, so a later change to a task's points leaves past months alone (acceptance test 4).

ScoringVersion keeps the configuration a score is worked out with: each activity's points, each role's weights, each person's
targets. A configuration change makes a new version effective from the current month (FR-S4); older months move only through an
explicit, audit-logged recalculation (§7), which is a version effective from an earlier month.

EventLog holds event-based activities (e.g. Work Order Received): logged with evidence, counting only once a supervisor verified
them (D2, FR-T5). Points are quantity × the activity's points; an event adds no output hours (§7).
"""
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

User = settings.AUTH_USER_MODEL


class ScoringVersion(models.Model):
    class Kind(models.TextChoices):
        BASE = "base", "First version"
        CONFIG = "config", "Configuration change"
        RECALC = "recalc", "Recalculation"
        IMPORT = "import", "Workbook import"
        RESTORE = "restore", "Backup restored"

    number = models.PositiveIntegerField(unique=True)
    effective_from = models.DateField(db_index=True, help_text="The first day it applies to: always the first of a month, or the base date.")
    kind = models.CharField(max_length=7, choices=Kind.choices, default=Kind.CONFIG)
    config = models.JSONField(help_text='{"points": {task: n}, "weights": {role: {metric: %}}, "sheets": {sheet: {role, targets, start}}, "count_weekend": bool}')
    changes = models.JSONField(default=list, blank=True, help_text="What changed from the version before, in plain words.")
    reason = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]

    def __str__(self):
        return f"Version {self.number}"


class EventLog(models.Model):
    """FR-T5, D2: an event-based activity, with its evidence. It counts from the moment a supervisor verifies it."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for verification"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Not verified"

    sheet = models.ForeignKey("team.Sheet", on_delete=models.CASCADE, related_name="events")
    day = models.DateField(db_index=True)
    activity = models.ForeignKey("team.Task", on_delete=models.PROTECT, related_name="events")
    quantity = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(1000)])
    evidence = models.CharField(max_length=300, help_text="A reference or link a supervisor can check.")
    note = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING, db_index=True)
    record = models.ForeignKey("tracker.Prospect", null=True, blank=True, on_delete=models.SET_NULL, related_name="score_events",
                               help_text="The won record, when a supervisor's verification of the win created it (FR-K2).")
    decided_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=300, blank=True)
    by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-day", "-id"]

    def __str__(self):
        return f"{self.activity} × {self.quantity} on {self.day}"


class ScoreLedger(models.Model):
    """FR-S1: one counted hour slot or verified event, with its points pinned to a configuration version."""

    class Source(models.TextChoices):
        PLAN = "plan", "Approved plan"
        DEVIATION = "deviation", "Approved deviation"
        UNPLANNED = "unplanned", "Unplanned hour"
        TASK = "task", "My Tasks"
        STEP = "step", "Framework step"
        EVENT = "event", "Verified event"
        LEGACY = "legacy", "Logged before plans"

    sheet = models.ForeignKey("team.Sheet", on_delete=models.CASCADE, related_name="ledger")
    member = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="score_ledger")
    day = models.DateField()
    slot = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Which hour (0–9). Empty for an event.")
    event = models.OneToOneField(EventLog, null=True, blank=True, on_delete=models.CASCADE, related_name="ledger")
    activity = models.ForeignKey("team.Task", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    activity_name = models.CharField(max_length=120)
    category = models.CharField(max_length=80, blank=True)
    quantity = models.PositiveSmallIntegerField(default=1)
    hours = models.DecimalField(max_digits=4, decimal_places=2, default=1, help_text="Output hours: one slot length for an hour, nothing for an event.")
    points = models.DecimalField(max_digits=10, decimal_places=2)
    version = models.ForeignKey(ScoringVersion, on_delete=models.PROTECT, related_name="entries")
    source = models.CharField(max_length=9, choices=Source.choices, default=Source.LEGACY)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["day", "slot", "id"]
        indexes = [models.Index(fields=["sheet", "day"]), models.Index(fields=["member", "day"])]
        constraints = [models.UniqueConstraint(fields=["sheet", "day", "slot"], condition=Q(slot__isnull=False), name="one_ledger_row_per_slot")]

    def __str__(self):
        return f"{self.day} {self.activity_name} {self.points}"
