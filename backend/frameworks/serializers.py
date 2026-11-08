import re

from django.db import transaction
from rest_framework import serializers

from team.models import Task
from tracker.models import PipelineStage

from . import services
from .models import Framework, OutcomeRule, StepInstance, StepType

KEY = re.compile(r"^[a-z0-9]{1,12}$")


def _words(v, n):
    return " ".join(str(v or "").split())[:n]


class StepSerializer(serializers.Serializer):
    """FR-SF2: one step. Days count working days from the day the record enters the stage (0 = that day)."""

    key = serializers.CharField(max_length=12, required=False, allow_blank=True)
    title = serializers.CharField(max_length=120)
    day_offset = serializers.IntegerField(min_value=0, max_value=365)
    type = serializers.ChoiceField(choices=StepType.choices)
    activity = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all(), allow_null=True, required=False)
    resource_url = serializers.URLField(max_length=300, required=False, allow_blank=True)
    instruction = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    stop_on = serializers.ListField(child=serializers.CharField(max_length=60), required=False, max_length=12)

    def validate_key(self, v):
        if v and not KEY.match(v):
            raise serializers.ValidationError("A step key is up to 12 lowercase letters and digits.")
        return v

    def validate_title(self, v):
        v = _words(v, 120)
        if not v:
            raise serializers.ValidationError("Give the step a title.")
        return v


class RuleSerializer(serializers.Serializer):
    """FR-SF3: an outcome may retry in N working days (max M times), jump to a step, or flag the record for stage review."""

    outcome = serializers.CharField(max_length=60)
    step_key = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")
    action = serializers.ChoiceField(choices=OutcomeRule.Action.choices)
    retry_days = serializers.IntegerField(min_value=1, max_value=60, required=False, default=1)
    retry_max = serializers.IntegerField(min_value=1, max_value=10, required=False, default=2)
    jump_key = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")


class FrameworkSerializer(serializers.ModelSerializer):
    """FR-SF1: the studio saves a whole framework at once: details, outcomes, steps and outcome rules."""

    stage = serializers.SlugRelatedField(slug_field="key", queryset=PipelineStage.objects.all())
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    stage_kind = serializers.CharField(source="stage.kind", read_only=True)
    steps = StepSerializer(many=True)
    rules = RuleSerializer(many=True, required=False)
    outcomes = serializers.ListField(child=serializers.CharField(max_length=60), required=False, max_length=12)
    records = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Framework
        fields = ["id", "name", "description", "stage", "stage_name", "stage_kind", "segment", "active", "is_default", "version", "outcomes",
                  "pack", "steps", "rules", "records", "updated_by_name", "updated_at"]
        read_only_fields = ["is_default", "version", "pack", "updated_at"]

    def to_representation(self, fw):
        out = super().to_representation(fw)
        names = {t.id: (t.name, float(t.points)) for t in Task.objects.filter(pk__in=[s["activity"] for s in out["steps"] if s.get("activity")])}
        for s in out["steps"]:
            s["activity_name"], s["activity_points"] = names.get(s.get("activity"), (None, None))
        return out

    def get_records(self, fw):
        return fw.assignments.filter(active=True).count()

    def get_updated_by_name(self, fw):
        return services.person(fw.updated_by) or None

    def validate_name(self, v):
        v = _words(v, 80)
        if not v:
            raise serializers.ValidationError("Give the framework a name.")
        return v

    def validate_segment(self, v):
        return _words(v, 80)

    def validate_stage(self, v):
        if not v.active:
            raise serializers.ValidationError("That stage is switched off.")
        return v

    def validate_outcomes(self, v):
        out = []
        for x in v:
            x = _words(x, 60)
            if x and x.lower() not in {o.lower() for o in out}:
                out.append(x)
        if not out:
            raise serializers.ValidationError("Keep at least one outcome.")
        return out

    def validate(self, attrs):
        outcomes = attrs.get("outcomes") or (self.instance.outcomes if self.instance else None) or services.default_outcomes()
        attrs["outcomes"] = outcomes
        lower = {o.lower(): o for o in outcomes}
        errors = {}
        steps = attrs.get("steps")
        if steps is None and self.instance is not None:
            steps = [{"key": s.key, "day_offset": s.day_offset} for s in self.instance.steps.all()]
        if not steps:
            errors["steps"] = "Add at least one step."
        elif len(steps) > 30:
            errors["steps"] = "Keep it to 30 steps or fewer."
        else:
            seen = set()
            for s in steps:
                if s.get("key"):
                    if s["key"] in seen:
                        errors["steps"] = "Two steps have the same key."
                    seen.add(s["key"])
                for st in s.get("stop_on") or []:
                    if st.lower() not in lower:
                        errors["steps"] = f"“{st}” isn't one of the outcomes."
                s["stop_on"] = [lower[x.lower()] for x in (s.get("stop_on") or []) if x.lower() in lower]
                if s.get("activity") is not None and not s["activity"].active:
                    errors["steps"] = f"The activity {s['activity'].name} is switched off."
            # FR-SF2: steps follow their day order; for the same day, the order given.
            steps.sort(key=lambda s: s["day_offset"])
            for s in steps:
                s.setdefault("key", "")
                if not s["key"]:
                    s["key"] = services.new_key()
                    while s["key"] in seen:
                        s["key"] = services.new_key()
                    seen.add(s["key"])
        if "steps" in attrs:
            attrs["steps"] = steps
        order = {s["key"]: i for i, s in enumerate(steps or [])}
        rules, pairs = [], set()
        for r in attrs.get("rules") or []:
            o = lower.get(_words(r["outcome"], 60).lower())
            if o is None:
                errors["rules"] = f"“{r['outcome']}” isn't one of the outcomes."
                continue
            if r["step_key"] and r["step_key"] not in order:
                errors["rules"] = "A rule points at a step that isn't there any more."
                continue
            if (o, r["step_key"]) in pairs:
                errors["rules"] = f"There are two rules for “{o}”" + (" on the same step." if r["step_key"] else ".")
                continue
            pairs.add((o, r["step_key"]))
            if r["action"] == OutcomeRule.Action.JUMP:
                if r["jump_key"] not in order:
                    errors["rules"] = f"Choose the step “{o}” jumps to."
                    continue
                if r["step_key"] and order[r["jump_key"]] <= order[r["step_key"]]:
                    errors["rules"] = f"“{o}” must jump to a later step."
                    continue
            else:
                r["jump_key"] = ""
            rules.append({**r, "outcome": o})
        if "rules" in attrs:
            attrs["rules"] = rules
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @transaction.atomic
    def create(self, data):
        user = self.context["request"].user
        steps, rules = data.pop("steps"), data.pop("rules", [])
        fw = Framework.objects.create(**data, created_by=user, updated_by=user)
        services.replace_steps(fw, steps, rules)
        services.save_version(fw, user)
        return fw

    @transaction.atomic
    def update(self, fw, data):
        user = self.context["request"].user
        before = services.snapshot(fw)
        steps, rules = data.pop("steps", None), data.pop("rules", None)
        for k, v in data.items():
            setattr(fw, k, v)
        fw.updated_by = user
        if fw.is_default and (before["stage"] != fw.stage.key or services._seg(before["segment"]) != services._seg(fw.segment) or not fw.active):
            fw.is_default = False          # it no longer is the default where it was
        fw.save()
        if steps is not None or rules is not None:
            services.replace_steps(fw, steps if steps is not None else before["steps"],
                                   rules if rules is not None else [{k: r[k] for k in ("outcome", "step_key", "action", "retry_days", "retry_max", "jump_key")}
                                                                    for r in before["rules"]])
        fw = Framework.objects.get(pk=fw.pk)
        if services.changed(before, services.snapshot(fw)):
            fw.version += 1
            fw.save(update_fields=["version"])
            services.save_version(fw, user)
        return fw


class StepInstanceSerializer(serializers.ModelSerializer):
    company = serializers.CharField(source="record.company", read_only=True)
    framework = serializers.CharField(source="assignment.framework.name", read_only=True)
    type_label = serializers.CharField(source="get_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    activity_name = serializers.SerializerMethodField()
    activity_points = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()
    outcomes = serializers.SerializerMethodField()

    class Meta:
        model = StepInstance
        fields = ["id", "record", "company", "framework", "assignment", "step_key", "position", "attempt", "title", "type", "type_label", "day_offset",
                  "activity", "activity_name", "activity_points", "resource_url", "instruction", "stop_on", "due_date", "status", "status_label",
                  "outcome", "note", "reason", "done_at", "logged_day", "logged_hour", "overdue", "outcomes"]

    def get_activity_name(self, s):
        return s.activity.name if s.activity else None

    def get_activity_points(self, s):
        return float(s.activity.points) if s.activity else None

    def get_overdue(self, s):
        return s.status == StepInstance.Status.OPEN and s.due_date < self.context["today"]

    def get_outcomes(self, s):
        cache = self.context.setdefault("_outcomes", {})
        if s.assignment_id not in cache:
            cache[s.assignment_id] = services.version_data(s.assignment).get("outcomes") or services.default_outcomes()
        return cache[s.assignment_id]


class CompleteSerializer(serializers.Serializer):
    outcome = serializers.CharField(max_length=60)
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    next_date = serializers.DateField(required=False, allow_null=True, default=None)
    next_action = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class DropSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)
    next_date = serializers.DateField(required=False, allow_null=True, default=None)
    next_action = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
