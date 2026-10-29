from rest_framework import serializers

from . import services
from . import template as T
from .models import Activity, PlanDay, Prospect, TrackerSettings


class TrackerSettingsSerializer(serializers.ModelSerializer):
    stages = serializers.SerializerMethodField()
    milestones = serializers.SerializerMethodField()
    activity_types = serializers.SerializerMethodField()

    class Meta:
        model = TrackerSettings
        fields = ["product", "tagline", "period_start", "period_days", "targets", "weeks", "rules", "lists", "plan_template", "share_with_admins",
                  "stages", "milestones", "activity_types", "updated_at"]
        read_only_fields = ["updated_at"]

    def get_stages(self, _):
        return [{"key": k, "label": l} for k, l in T.STAGES]

    def get_milestones(self, obj):
        return [{"key": k, "label": l, "points": services.rate(obj, k)} for k, l, _ in T.MILESTONES]

    def get_activity_types(self, obj):
        return [{"key": k, "label": l, "points": services.rate(obj, k)} for k, l, _ in T.ACTIVITIES]

    def validate_targets(self, v):
        if not isinstance(v, dict):
            raise serializers.ValidationError("Targets must be an object.")
        return {k: max(0, float(v.get(k) or 0)) for k in ("points", "leads", "opps", "clients")}

    def validate_weeks(self, v):
        if not isinstance(v, list) or len(v) > 20:
            raise serializers.ValidationError("Weeks must be a list.")
        return [{"leads": max(0, float(w.get("leads") or 0)), "opps": max(0, float(w.get("opps") or 0)), "clients": max(0, float(w.get("clients") or 0)),
                 "points": max(0, float(w.get("points") or 0)), "focus": str(w.get("focus") or "")[:200]} for w in v if isinstance(w, dict)]

    def validate_rules(self, v):
        if not isinstance(v, dict):
            raise serializers.ValidationError("Point rules must be an object.")
        return {k: max(0.0, float(v[k])) for k in T.DEFAULT_RULES if isinstance(v.get(k), (int, float))}

    def validate_lists(self, v):
        if not isinstance(v, dict):
            raise serializers.ValidationError("Lists must be an object.")
        return {k: [str(x).strip()[:80] for x in (v.get(k) or T.LISTS[k]) if str(x).strip()][:100] for k in T.LISTS}


class ProspectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Prospect
        exclude = ["owner"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_company(self, v):
        if not v.strip():
            raise serializers.ValidationError("Give the company a name.")
        return v.strip()

    def create(self, data):
        stage = data.pop("stage", "prospect")
        p = Prospect(owner=self.context["request"].user, **data)
        services.apply_stage(p, stage)
        p.save()
        return p

    def update(self, p, data):
        stage = data.pop("stage", None)
        for k, v in data.items():
            setattr(p, k, v)
        if stage and stage != p.stage:
            services.apply_stage(p, stage)
        p.save()
        return p


class ActivitySerializer(serializers.ModelSerializer):
    points = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = ["id", "date", "type", "qty", "note", "points", "created_at"]

    def get_points(self, a):
        return round(services.act_points(self.context["settings"], a), 2)

    def validate_type(self, v):
        if v not in T.DEFAULT_RULES or v.startswith("m_"):
            raise serializers.ValidationError("Unknown activity type.")
        return v


class PlanDayWriteSerializer(serializers.Serializer):
    tasks = serializers.ListField(child=serializers.DictField(), max_length=60)
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")

    def validate_tasks(self, tasks):
        out = []
        for t in tasks:
            text = str(t.get("text", "")).strip()[:300]
            if text:
                out.append({"id": str(t.get("id") or "")[:40] or None, "text": text, "done": bool(t.get("done"))})
        return out
