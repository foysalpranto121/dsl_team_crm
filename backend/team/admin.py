from django.contrib import admin

from .models import JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings


@admin.register(TeamSettings)
class TeamSettingsAdmin(admin.ModelAdmin):
    list_display = ["name", "timezone", "lock_days", "week_start_dow", "currency"]


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "points", "active", "position"]
    list_editable = ["points", "active", "position"]
    list_filter = ["type", "active"]
    search_fields = ["name"]


@admin.register(JobRole)
class JobRoleAdmin(admin.ModelAdmin):
    list_display = ["name", "w_hours", "w_points", "w_leads", "w_opps", "w_clients", "w_revenue"]
    filter_horizontal = ["tasks"]


@admin.register(Sheet)
class SheetAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "owner", "role", "target_hours", "target_points", "archived"]
    list_filter = ["kind", "archived", "role"]


@admin.register(SheetEntry)
class SheetEntryAdmin(admin.ModelAdmin):
    list_display = ["sheet", "day", "slots", "updated_by", "updated_at"]
    list_filter = ["sheet"]
    date_hierarchy = "day"


@admin.register(KpiEntry)
class KpiEntryAdmin(admin.ModelAdmin):
    list_display = ["sheet", "week_start", "leads", "opps", "clients", "revenue"]
    list_filter = ["sheet"]
