from django.contrib import admin

from .models import EventLog, ScoreLedger, ScoringVersion


@admin.register(ScoringVersion)
class ScoringVersionAdmin(admin.ModelAdmin):
    list_display = ["number", "kind", "effective_from", "created_by", "created_at"]
    readonly_fields = ["number", "kind", "effective_from", "config", "changes", "reason", "created_by", "created_at"]


@admin.register(ScoreLedger)
class ScoreLedgerAdmin(admin.ModelAdmin):
    """Read-only: rows are written from the hours and events, never typed (FR-S1)."""

    list_display = ["day", "sheet", "slot", "activity_name", "points", "version", "source"]
    list_filter = ["sheet", "source"]
    date_hierarchy = "day"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(EventLog)
class EventLogAdmin(admin.ModelAdmin):
    list_display = ["day", "sheet", "activity", "quantity", "status", "decided_by"]
    list_filter = ["status", "activity"]
