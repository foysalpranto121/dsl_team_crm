"""My Tasks (SRS v0.5 §5.6): a personal to-do list with calendar dates.

Titles are free text. A task may carry an Activity Type (team.Task); completing it then offers to log one free hour of that
type (FR-MT5). Supervisors can assign tasks (FR-MT4): those show "Assigned by" and are pre-approved for scoring. Personal
titles are private; supervisors see counts and the tasks they assigned (FR-MT6).
"""
from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL


class PersonalTask(models.Model):
    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        DONE = "done", "Done"
        DROPPED = "dropped", "Dropped"

    class Repeat(models.TextChoices):
        NONE = "none", "Doesn't repeat"
        DAILY = "daily", "Every working day"
        WEEKLY = "weekly", "Every week"

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="personal_tasks")
    title = models.CharField(max_length=200)
    due_date = models.DateField(db_index=True)
    due_time = models.TimeField(null=True, blank=True)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NORMAL)
    client = models.ForeignKey("tracker.Prospect", null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks")
    activity = models.ForeignKey("team.Task", null=True, blank=True, on_delete=models.SET_NULL, related_name="personal_tasks",
                                 help_text="The Activity Type: logging the task as an hour earns its points (SRS D5).")
    status = models.CharField(max_length=7, choices=Status.choices, default=Status.OPEN, db_index=True)
    drop_reason = models.CharField(max_length=200, blank=True)
    repeat = models.CharField(max_length=6, choices=Repeat.choices, default=Repeat.NONE)
    assigned_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_tasks")
    done_at = models.DateTimeField(null=True, blank=True)
    logged_day = models.DateField(null=True, blank=True, help_text="The day and hour the task was logged as work, if it was.")
    logged_hour = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "due_time", "-priority", "id"]
        indexes = [models.Index(fields=["owner", "status", "due_date"])]

    def __str__(self):
        return self.title
