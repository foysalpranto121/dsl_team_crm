from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Profile, User


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    readonly_fields = ["completed_at", "updated_at"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["-requested_at"]
    list_display = ["email", "name", "status", "role", "requested_at", "last_login"]
    list_filter = ["status", "role", "is_active", "is_staff"]
    search_fields = ["email", "name"]
    readonly_fields = ["google_sub", "requested_at", "approved_at", "approved_by", "last_login", "date_joined"]
    inlines = [ProfileInline]
    fieldsets = [
        (None, {"fields": ["email", "name", "password"]}),
        ("Access", {"fields": ["status", "role", "is_active", "approved_by", "approved_at", "requested_at"]}),
        ("Google", {"fields": ["google_sub", "google_picture"]}),
        ("Django admin site", {"fields": ["is_staff", "is_superuser", "groups", "user_permissions"]}),
        ("Dates", {"fields": ["last_login", "date_joined"]}),
    ]
    add_fieldsets = [(None, {"classes": ["wide"], "fields": ["email", "name", "status", "role", "password1", "password2"]})]
