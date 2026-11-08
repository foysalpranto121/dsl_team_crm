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
        fields = ["name", "timezone", "lock_days", "week_start_dow", "weekend_days", "count_weekend", "currency", "unplanned_mode", "plan_cutoff",
                  "feature_tv", "feature_huddle", "feature_digest", "feature_renewals", "kpi_mode", "kpi_from", "lost_reasons",
                  "holidays", "overload_items", "overload_days", "today", "seconds_to_lock", "updated_at"]
        read_only_fields = ["updated_at"]

    def get_today(self, obj):
        return calc.today_in(obj.timezone, services.now())

    def get_seconds_to_lock(self, obj):
        return calc.seconds_to_midnight(obj.timezone, services.now())

    def validate_weekend_days(self, v):
        if not isinstance(v, list) or any(d not in range(7) for d in v) or len(set(v)) > 3:
            raise serializers.ValidationError("Pick up to three weekend days (0 = Sunday … 6 = Saturday).")
        return sorted(set(v))

    def validate_lost_reasons(self, v):
        if not isinstance(v, list):
            raise serializers.ValidationError("Lost reasons must be a list.")
        out = []
        for x in v:
            x = " ".join(str(x).split())[:80]
            if x and x.lower() not in {o.lower() for o in out}:
                out.append(x)
        if not out:
            raise serializers.ValidationError("Keep at least one lost reason.")
        return out[:30]

    def validate_holidays(self, v):
        from datetime import date
        if not isinstance(v, list) or len(v) > 400:
            raise serializers.ValidationError("Holidays must be a list of dates.")
        out = set()
        for x in v:
            try:
                out.add(date.fromisoformat(str(x)).isoformat())
            except ValueError:
                raise serializers.ValidationError(f"{x} isn't a date (use YYYY-MM-DD).")
        return sorted(out)

    def validate(self, attrs):
        week_start = attrs.get("week_start_dow", self.instance.week_start_dow if self.instance else 6)
        if attrs.get("kpi_from") and calc.dow(attrs["kpi_from"]) != week_start:
            raise serializers.ValidationError({"kpi_from": "The cut-over date must be the first day of a week."})
        return attrs


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
        fields = ["day", "slots", "meta", "remarks", "logged", "hours", "points", "updated_by", "updated_at"]

    logged = serializers.SerializerMethodField()

    def get_logged(self, obj):
        """Hours with a task logged, counted or not (hours and points count only output hours)."""
        return calc.day_hours(obj.slots)

    def get_hours(self, obj):
        return calc.day_hours(obj.counted_slots())

    def get_points(self, obj):
        return calc.day_points(obj.counted_slots(), self.context["pts"])

    def get_updated_by(self, obj):
        return (obj.updated_by.name or obj.updated_by.email) if obj.updated_by else None


class HourMetaSerializer(serializers.Serializer):
    """One logged hour's details (SRS v0.5 FR-T1): how it went, quantity, output reference, and the reason for a deviation
    or a Not done."""
    status = serializers.ChoiceField(choices=["done", "partly", "not_done"], required=False, allow_null=True)
    qty = serializers.IntegerField(min_value=0, max_value=100000, required=False, allow_null=True)
    ref = serializers.CharField(max_length=200, required=False, allow_blank=True)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True)
    task = serializers.IntegerField(required=False, allow_null=True, min_value=1, help_text="The My Tasks task this hour was logged from.")


class EntryWriteSerializer(serializers.Serializer):
    slots = serializers.ListField(child=serializers.IntegerField(allow_null=True, min_value=1), max_length=10, allow_empty=True)
    remarks = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")
    meta = serializers.ListField(child=HourMetaSerializer(allow_null=True), max_length=10, required=False, allow_null=True)


class KpiSerializer(serializers.ModelSerializer):
    """A week's results. source: typed in, or worked out from the pipeline (derived = before a supervisor's adjust).
    stale: the numbers changed after the member confirmed them."""

    updated_by = serializers.SerializerMethodField()
    adjusted_by = serializers.SerializerMethodField()
    confirmed_by = serializers.SerializerMethodField()
    stale = serializers.SerializerMethodField()

    class Meta:
        model = KpiEntry
        fields = ["week_start", "leads", "opps", "clients", "revenue", "notes", "updated_by", "updated_at", "source", "derived", "adjust",
                  "adjust_note", "adjusted_by", "adjusted_at", "confirmed", "confirmed_by", "confirmed_at", "stale"]
        read_only_fields = ["week_start", "updated_by", "updated_at", "source", "derived", "adjust", "adjust_note", "adjusted_at", "confirmed",
                            "confirmed_at"]

    @staticmethod
    def _name(u):
        return (u.name or u.email) if u else None

    def get_updated_by(self, obj):
        return self._name(obj.updated_by)

    def get_adjusted_by(self, obj):
        return self._name(obj.adjusted_by)

    def get_confirmed_by(self, obj):
        return self._name(obj.confirmed_by)

    def get_stale(self, obj):
        if not obj.confirmed_at:
            return False
        now = {"leads": obj.leads, "opps": obj.opps, "clients": obj.clients, "revenue": float(obj.revenue)}
        return any(float(obj.confirmed.get(k, 0)) != float(v) for k, v in now.items())


class KpiAdjustSerializer(serializers.Serializer):
    leads = serializers.IntegerField(min_value=0, required=False)
    opps = serializers.IntegerField(min_value=0, required=False)
    clients = serializers.IntegerField(min_value=0, required=False)
    revenue = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
    note = serializers.CharField(max_length=300)
