from django.contrib import admin

from .models import AiSuggestion, PlaybookDay, PlaybookItem


@admin.register(PlaybookDay)
class PlaybookDayAdmin(admin.ModelAdmin):
    list_display = ["owner", "day", "opened_at", "closed_at"]
    list_filter = ["day"]


@admin.register(PlaybookItem)
class PlaybookItemAdmin(admin.ModelAdmin):
    list_display = ["day", "key", "group", "title", "weight", "done_at"]


@admin.register(AiSuggestion)
class AiSuggestionAdmin(admin.ModelAdmin):
    list_display = ["owner", "day", "rule", "title", "feedback", "dismissed_at"]
