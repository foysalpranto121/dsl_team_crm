from django.contrib import admin

from .models import DigestLog


@admin.register(DigestLog)
class DigestLogAdmin(admin.ModelAdmin):
    list_display = ["week_start", "sent_at", "sent_by"]
    readonly_fields = ["week_start", "sent_at", "recipients", "sent_by"]
