from django.contrib import admin

from .models import PersonalTask


@admin.register(PersonalTask)
class PersonalTaskAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "due_date", "status", "assigned_by")
    list_filter = ("status", "priority")
    raw_id_fields = ("owner", "client", "activity", "assigned_by")
