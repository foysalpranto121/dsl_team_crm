from django.contrib import admin

from .models import DisplayScreen


@admin.register(DisplayScreen)
class DisplayScreenAdmin(admin.ModelAdmin):
    list_display = ["name", "active", "panels", "leaders", "show_values", "last_seen_at", "token_hint"]
    readonly_fields = ["token_hint", "last_seen_at", "created_by", "created_at", "updated_at"]
    exclude = ["token_hash"]
