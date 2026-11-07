from decimal import Decimal

from rest_framework import serializers

from accounts.models import User

from . import calc, services
from .models import METRICS, JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings


class TeamSettingsSerializer(serializers.ModelSerializer):
    today = serializers.SerializerMethodField()
    seconds_to_lock = serializers.SerializerMethodField()

    class Meta:
        model = TeamSettings
        fields = ["name", "timezone", "lock_days", "week_start_dow", "weekend_days", "count_weekend", "currency", "today", "seconds_to_lock", "updated_at"]
        read_only_fields = ["updated_at"]

    def get_today(self, obj):
        return calc.today_in(obj.timezone, services.now())

    def get_seconds_to_lock(self, obj):
        return calc.seconds_to_midnight(obj.timezone, services.now())

    def validate_weekend_days(self, v):
        if not isinstance(v, list) or any(d not in range(7) for d in v) or len(set(v)) > 3:
            raise serializers.ValidationError("Pick up to three weekend days (0 = Sunday … 6 = Saturday).")
        return sorted(set(v))


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "type", "name", "points", "active", "position", "counts_as_win"]


class JobRoleSerializer(serializers.ModelSerializer):
    tasks = serializers.PrimaryKeyRelatedField(many=True, queryset=Task.objects.all(), required=False)
    weights_total = serializers.SerializerMethodField()

    class Meta:
        model = JobRole
        fields = ["id", "name", "tasks", *("w_" + m for m in METRICS), "weights_total"]

    def get_weights_total(self, obj):
        return sum(obj.weights.values())

    def validate(self, attrs):
        current = {m: getattr(self.instance, "w_" + m) if self.instance else Decimal(0) for m in METRICS}
        total = sum(attrs.get("w_" + m, current[m]) for m in METRICS)
        if total != 100:
            raise serializers.ValidationError(f"Weightages must add up to 100% (now {total}%).")
        return attrs


class SheetSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(status=User.Status.APPROVED), allow_null=True, required=False)
    owner_name = serializers.SerializerMethodField()
    role_name = serializers.CharField(source="role.name", read_only=True, default=None)
    mine = serializers.SerializerMethodField()

    class Meta:
        model = Sheet
        fields = ["id", "name", "kind", "owner", "owner_name", "person", "role", "role_name", *("target_" + m for m in METRICS),
                  "start_date", "position", "archived", "mine", "updated_at"]

    def get_owner_name(self, obj):
        return (obj.owner.name or obj.owner.email) if obj.owner else None

    def get_mine(self, obj):
        return obj.owner_id == self.context["request"].user.pk

    def validate_owner(self, user):
        if user and user.role == User.Role.VIEWER:
            raise serializers.ValidationError("Viewers can't fill in sheets. Change their role to member first.")
        return user

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError("Give the sheet a name.")
        return v


class EntrySerializer(serializers.ModelSerializer):
    hours = serializers.SerializerMethodField()
    points = serializers.SerializerMethodField()
    updated_by = serializers.SerializerMethodField()

    class Meta:
        model = SheetEntry
        fields = ["day", "slots", "remarks", "hours", "points", "updated_by", "updated_at"]

    def get_hours(self, obj):
        return calc.day_hours(obj.slots)

    def get_points(self, obj):
        return calc.day_points(obj.slots, self.context["pts"])

    def get_updated_by(self, obj):
        return (obj.updated_by.name or obj.updated_by.email) if obj.updated_by else None


class EntryWriteSerializer(serializers.Serializer):
    slots = serializers.ListField(child=serializers.IntegerField(allow_null=True, min_value=1), max_length=10, allow_empty=True)
    remarks = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class KpiSerializer(serializers.ModelSerializer):
    updated_by = serializers.SerializerMethodField()

    class Meta:
        model = KpiEntry
        fields = ["week_start", "leads", "opps", "clients", "revenue", "notes", "updated_by", "updated_at"]
        read_only_fields = ["week_start", "updated_by", "updated_at"]

    def get_updated_by(self, obj):
        return (obj.updated_by.name or obj.updated_by.email) if obj.updated_by else None
