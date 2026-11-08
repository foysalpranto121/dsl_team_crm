"""Stage Frameworks (SRS v0.5 §5.7, data model §8).

A framework is a reusable schedule of steps for a client at a pipeline stage (for example Qualified Lead: 14-day follow-up).
When a record enters the stage, its default framework (FrameworkAssignment) creates dated steps (StepInstance) on the team's
working days. Completing a step asks for an outcome; the framework's outcome rules may retry the step, jump to a later step
or flag the record for stage review (OutcomeRule). Edits make a new version (FrameworkVersion) and affect new records only,
unless a supervisor applies them to open records. A member with too many overdue items is flagged (OverloadFlag): their new
steps wait in a queue until the flag clears (D6, FR-SF6).
"""
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

User = settings.AUTH_USER_MODEL


class StepType(models.TextChoices):
    CALL = "call", "Call"
    EMAIL = "email", "Email"
    WHATSAPP = "whatsapp", "WhatsApp"
    VISIT = "visit", "Visit"
    DEMO = "demo", "Demo"
    PROPOSAL = "proposal", "Proposal task"
    PREP = "prep", "Internal prep"
    CUSTOM = "custom", "Custom"


def default_outcomes():
    return ["Connected", "No answer", "Call later", "Not interested", "Done"]


class Framework(models.Model):
    """FR-SF1: name, description, target stage, optional segment/product filter, active flag, version."""

    name = models.CharField(max_length=80)
    description = models.CharField(max_length=500, blank=True)
    stage = models.ForeignKey("tracker.PipelineStage", on_delete=models.PROTECT, related_name="frameworks")
    segment = models.CharField(max_length=80, blank=True, help_text="Only for records of this segment or product. Empty = every record.")
    active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False, help_text="Records entering the stage get this framework (FR-SF4).")
    version = models.PositiveIntegerField(default=1)
    outcomes = models.JSONField(default=default_outcomes, help_text="What a member can answer when completing a step (FR-SF3).")
    pack = models.CharField(max_length=40, blank=True, help_text="The template pack it was loaded from (FR-SF10).")
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["stage__position", "-is_default", "name", "id"]

    def __str__(self):
        return self.name


class FrameworkStep(models.Model):
    """FR-SF2: one step of the current version. `key` stays the same across versions, so open records can be updated."""

    framework = models.ForeignKey(Framework, on_delete=models.CASCADE, related_name="steps")
    key = models.SlugField(max_length=12)
    position = models.PositiveSmallIntegerField(default=0)
    title = models.CharField(max_length=120)
    day_offset = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(365)],
                                                  help_text="Working days after the record enters the stage (0 = that day).")
    type = models.CharField(max_length=10, choices=StepType.choices, default=StepType.CALL)
    activity = models.ForeignKey("team.Task", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                                 help_text="Optional Activity Type: the step can then be logged in an hour slot and earn its points.")
    resource_url = models.URLField(max_length=300, blank=True, help_text="A template or resource for the step.")
    instruction = models.CharField(max_length=1000, blank=True)
    stop_on = models.JSONField(default=list, blank=True, help_text="Stop conditions: outcomes that end the framework for the record.")

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["framework", "key"], name="one_step_key_per_framework")]

    def __str__(self):
        return self.title


class OutcomeRule(models.Model):
    """FR-SF3: what an outcome does. Applies to one step, or to every step when step_key is empty."""

    class Action(models.TextChoices):
        RETRY = "retry", "Try again"
        JUMP = "jump", "Jump to a step"
        FLAG = "flag", "Flag the record for stage review"

    framework = models.ForeignKey(Framework, on_delete=models.CASCADE, related_name="rules")
    outcome = models.CharField(max_length=60)
    step_key = models.CharField(max_length=12, blank=True)
    action = models.CharField(max_length=5, choices=Action.choices)
    retry_days = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(60)])
    retry_max = models.PositiveSmallIntegerField(default=2, validators=[MinValueValidator(1), MaxValueValidator(10)])
    jump_key = models.CharField(max_length=12, blank=True)

    class Meta:
        ordering = ["id"]


class FrameworkVersion(models.Model):
    """FR-SF7: every saved change keeps a copy, so the steps a record got can always be explained."""

    framework = models.ForeignKey(Framework, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    data = models.JSONField()                    # {name, description, stage, segment, outcomes, steps: [...], rules: [...]}
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]
        constraints = [models.UniqueConstraint(fields=["framework", "number"], name="one_framework_version_number")]


class FrameworkAssignment(models.Model):
    """A framework running on one record at one stage (FR-SF4, FR-SF5). One active assignment per record."""

    record = models.ForeignKey("tracker.Prospect", on_delete=models.CASCADE, related_name="frameworks")
    framework = models.ForeignKey(Framework, on_delete=models.PROTECT, related_name="assignments")
    version = models.PositiveIntegerField()
    stage = models.CharField(max_length=20)
    started_on = models.DateField()
    chosen = models.BooleanField(default=False, help_text="The member picked it instead of the stage default.")
    active = models.BooleanField(default=True, db_index=True)
    closed_on = models.DateField(null=True, blank=True)
    closed_reason = models.CharField(max_length=200, blank=True)
    review_flag = models.BooleanField(default=False, help_text="An outcome flagged the record for stage review.")
    review_note = models.CharField(max_length=300, blank=True)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started_on", "-id"]


class StepInstance(models.Model):
    """A dated step for one record (FR-SF5). It keeps a copy of the step as it was, so later edits don't change it."""

    class Status(models.TextChoices):
        HELD = "held", "Waiting (member overloaded)"
        OPEN = "open", "Open"
        DONE = "done", "Done"
        DROPPED = "dropped", "Dropped"
        SKIPPED = "skipped", "Skipped"

    assignment = models.ForeignKey(FrameworkAssignment, on_delete=models.CASCADE, related_name="steps")
    record = models.ForeignKey("tracker.Prospect", on_delete=models.CASCADE, related_name="steps")
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="framework_steps")
    step_key = models.CharField(max_length=12)
    position = models.PositiveSmallIntegerField(default=0)
    attempt = models.PositiveSmallIntegerField(default=1)
    title = models.CharField(max_length=120)
    type = models.CharField(max_length=10, choices=StepType.choices, default=StepType.CALL)
    day_offset = models.PositiveSmallIntegerField(default=0)
    activity = models.ForeignKey("team.Task", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resource_url = models.URLField(max_length=300, blank=True)
    instruction = models.CharField(max_length=1000, blank=True)
    stop_on = models.JSONField(default=list, blank=True)
    due_date = models.DateField(db_index=True)
    status = models.CharField(max_length=7, choices=Status.choices, default=Status.OPEN, db_index=True)
    held_since = models.DateField(null=True, blank=True)
    outcome = models.CharField(max_length=60, blank=True)
    note = models.CharField(max_length=1000, blank=True)
    reason = models.CharField(max_length=300, blank=True, help_text="Why it was dropped or skipped.")
    done_at = models.DateTimeField(null=True, blank=True)
    done_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    log_entry = models.ForeignKey("tracker.ClientLogEntry", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    logged_day = models.DateField(null=True, blank=True, help_text="The day and hour the step was logged as work, if it was.")
    logged_hour = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "position", "attempt", "id"]
        indexes = [models.Index(fields=["owner", "status", "due_date"])]

    def __str__(self):
        return self.title


class OverloadFlag(models.Model):
    """FR-SF6, D6: raised when a member's open overdue items pass the team's threshold; cleared automatically when they fall
    back under it. While raised (and not overridden by a supervisor), the member's new framework steps wait in a queue."""

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="overload_flags")
    raised_at = models.DateTimeField(auto_now_add=True)
    items = models.PositiveIntegerField(default=0, help_text="Open overdue items when it was raised.")
    oldest_days = models.PositiveIntegerField(default=0, help_text="Working days the oldest overdue item had waited.")
    cleared_at = models.DateTimeField(null=True, blank=True, db_index=True)
    overridden_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    overridden_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-raised_at"]
