from django.contrib import admin

from .models import Framework, FrameworkAssignment, OverloadFlag, StepInstance


@admin.register(Framework)
class FrameworkAdmin(admin.ModelAdmin):
    list_display = ("name", "stage", "segment", "active", "is_default", "version")
    list_filter = ("active", "is_default", "stage")


@admin.register(FrameworkAssignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ("record", "framework", "version", "stage", "started_on", "active", "review_flag")
    list_filter = ("active", "review_flag")


@admin.register(StepInstance)
class StepInstanceAdmin(admin.ModelAdmin):
    list_display = ("title", "record", "owner", "due_date", "status", "outcome")
    list_filter = ("status", "type")


@admin.register(OverloadFlag)
class OverloadFlagAdmin(admin.ModelAdmin):
    list_display = ("owner", "raised_at", "items", "oldest_days", "cleared_at", "overridden_at")
