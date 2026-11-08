import re

from django.db import transaction
from rest_framework import serializers

from team.models import TeamSettings

from . import kpis, pipeline, services
from . import template as T
from .models import Activity, ClientLogEntry, KpiType, PipelineStage, PlanDay, Prospect, StageEvent, TrackerSettings

K = PipelineStage.Kind


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
        return [{"key": s.key, "label": s.name} for s in PipelineStage.objects.filter(active=True)]

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


def _ctx_stages(ctx):
    """The team's stages, loaded once per request (a list serializes many records)."""
    if "_stages" not in ctx:
        ctx["_stages"] = pipeline.stage_map()
        ctx["_today"] = pipeline.today()
    return ctx["_stages"]


class ProspectSerializer(serializers.ModelSerializer):
    """A pipeline record (SRS v0.5 FR-K1). Required: company, requirement, stage. An open record always has a dated next step
    (FR-CL3); stages from Proposal on need an expected value; Won and Lost need a win/loss note (FR-K11), Lost a reason (FR-K7)."""

    stage = serializers.CharField(max_length=60, required=False)
    stage_name = serializers.SerializerMethodField()
    stage_kind = serializers.SerializerMethodField()
    probability = serializers.SerializerMethodField()
    days_in_stage = serializers.SerializerMethodField()
    health = serializers.SerializerMethodField()
    verified = serializers.SerializerMethodField()
    framework = serializers.SerializerMethodField()
    old_steps = serializers.ChoiceField(choices=["keep", "drop"], write_only=True, required=False,
                                        help_text="On a stage change: keep the old framework's unfinished steps, or drop them (FR-SF5).")

    class Meta:
        model = Prospect
        exclude = ["owner", "won_verified_by"]
        read_only_fields = ["created_at", "updated_at", "stage_since", "won_verified_at", "lead_date", "opp_date", "client_date"]

    def _stage(self, p):
        return _ctx_stages(self.context).get(p.stage)

    def get_stage_name(self, p):
        st = self._stage(p)
        return st.name if st else p.stage

    def get_stage_kind(self, p):
        st = self._stage(p)
        return st.kind if st else K.OPEN

    def get_probability(self, p):
        st = self._stage(p)
        return st.probability if st else 0

    def get_days_in_stage(self, p):
        return (self.context["_today"] - p.stage_since).days if p.stage_since and "_today" in self.context else None

    def get_health(self, p):
        return pipeline.health(p, self._stage(p), self.context.get("_today"))

    def get_verified(self, p):
        return bool(p.won_verified_at)

    def get_framework(self, p):
        """The running framework and the next step (SRS v0.5 §5.7), loaded once per request for a list."""
        from frameworks.services import summaries
        cache = self.context.setdefault("_fw", {})
        if p.owner_id not in cache:
            cache[p.owner_id] = summaries(p.owner_id)
        return cache[p.owner_id].get(p.id)

    def validate_company(self, v):
        if not v.strip():
            raise serializers.ValidationError("Give the company a name.")
        return v.strip()

    def validate_deal_currency(self, v):
        v = v.strip().upper()
        if v and not re.fullmatch(r"[A-Z]{3}", v):
            raise serializers.ValidationError("Use a three-letter currency code, such as USD.")
        return v

    def validate(self, attrs):
        inst = self.instance
        get = lambda f: attrs[f] if f in attrs else (getattr(inst, f) if inst else None)  # noqa: E731
        stages = _ctx_stages(self.context)
        if "stage" in attrs or inst is None:
            st = pipeline.resolve(attrs.get("stage", ""), {k: s for k, s in stages.items() if s.active}) if attrs.get("stage") else pipeline.first_stage()
            if st is None:
                raise serializers.ValidationError({"stage": "Choose one of the team's stages."})
            attrs["stage"] = st.key
        stage = stages.get(get("stage"))
        errors = {}
        if not (get("requirement") or "").strip():
            errors["requirement"] = "Say what the client needs."
        if stage is not None:
            if stage.value_required and get("value") is None:
                errors["value"] = f"{stage.name} needs an expected value."
            entering = "stage" in attrs and (inst is None or attrs["stage"] != inst.stage)
            if stage.kind == K.OPEN:
                if not self._framework_next(inst, stage, get("segment"), entering):
                    if not (get("next_action") or "").strip():
                        errors["next_action"] = "An open record always needs a next step: what you'll do next."
                    if not get("next_follow_up"):
                        errors["next_follow_up"] = "And when you'll do it."
            else:
                if not (get("win_loss_why") or "").strip():
                    errors["win_loss_why"] = "Say why it was won." if stage.kind == K.WON else "Say why it was lost."
            if stage.kind == K.LOST:
                reason = (get("lost_reason") or "").strip()
                if not reason:
                    errors["lost_reason"] = "Choose why it was lost."
                elif "lost_reason" in attrs and reason not in (TeamSettings.load().lost_reasons or []):
                    errors["lost_reason"] = "Choose one of the team's lost reasons."
        if get("deal_value") is not None and not get("deal_currency"):
            errors["deal_currency"] = "Which currency is the deal priced in?"
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @staticmethod
    def _framework_next(inst, stage, segment, entering):
        """FR-CL3: an open record has a next framework step (or gets one on entering the stage), or a dated next action."""
        from frameworks import services as frameworks
        if entering or inst is None:
            return frameworks.covers(stage.key, segment or "")
        return inst.steps.filter(status__in=frameworks.WAITING).exists()

    @transaction.atomic
    def create(self, data):
        data.pop("old_steps", None)
        user = self.context["request"].user
        p = Prospect(owner=user, **data)
        p.save()
        pipeline.move(p, p.stage, user, initial=True)
        return p

    @transaction.atomic
    def update(self, p, data):
        stage = data.pop("stage", None)
        old_steps = data.pop("old_steps", "keep")
        for k, v in data.items():
            setattr(p, k, v)
        p.save()
        if stage and stage != p.stage:
            pipeline.move(p, stage, self.context["request"].user, old_steps=old_steps)
        elif "value" in data:
            kpis.refresh(p.owner_id)   # a verified win's value is revenue
        return p


class ClientLogSerializer(serializers.ModelSerializer):
    """FR-CL1: type, outcome, note; a next date (and action) becomes the record's next step."""

    type_label = serializers.CharField(source="get_type_display", read_only=True)
    by_name = serializers.SerializerMethodField()
    next_action = serializers.CharField(max_length=200, required=False, allow_blank=True, write_only=True)
    day = serializers.DateField(required=False)

    class Meta:
        model = ClientLogEntry
        fields = ["id", "type", "type_label", "outcome", "note", "day", "next_date", "next_action", "by_name", "created_at"]
        read_only_fields = ["created_at"]

    def get_by_name(self, e):
        return (e.by.name or e.by.email) if e.by else None

    def validate_type(self, v):
        if v == ClientLogEntry.Type.STAGE:
            raise serializers.ValidationError("Stage changes are logged automatically.")
        return v


class StageSerializer(serializers.ModelSerializer):
    """FR-K9: the team's sales process."""

    key = serializers.SlugField(max_length=20, required=False)
    records = serializers.SerializerMethodField()

    class Meta:
        model = PipelineStage
        fields = ["id", "key", "name", "kind", "position", "expected_days", "probability", "exit_criteria", "value_required", "active", "records"]

    def get_records(self, s):
        return self.context.get("_counts", {}).get(s.key, 0)

    def validate_key(self, v):
        if self.instance and v != self.instance.key:
            raise serializers.ValidationError("A stage's key can't change once it exists.")
        return v

    def validate(self, attrs):
        if self.instance is None and not attrs.get("key"):
            base = re.sub(r"[^a-z0-9]+", "-", attrs.get("name", "").lower()).strip("-")[:16] or "stage"
            key, n = base, 1
            while PipelineStage.objects.filter(key=key).exists():
                n += 1
                key = f"{base}-{n}"
            attrs["key"] = key
        kind = attrs.get("kind", self.instance.kind if self.instance else K.OPEN)
        active = attrs.get("active", self.instance.active if self.instance else True)
        if self.instance and (kind != self.instance.kind or not active):
            others = PipelineStage.objects.exclude(pk=self.instance.pk).filter(active=True)
            for k, label in ((K.WON, "Won"), (K.LOST, "Lost"), (K.OPEN, "open")):
                if self.instance.kind == k and not others.filter(kind=k).exists():
                    raise serializers.ValidationError({"kind": f"The process needs at least one active {label} stage."})
        return attrs


class KpiTypeSerializer(serializers.ModelSerializer):
    """FR-C6: what each weekly KPI counts. The four keys are fixed because scoring uses them; the rest is the team's."""

    stage = serializers.SlugRelatedField(slug_field="key", queryset=PipelineStage.objects.all())
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    unit = serializers.SerializerMethodField()

    class Meta:
        model = KpiType
        fields = ["id", "key", "name", "definition", "stage", "stage_name", "verified_only", "unit"]
        read_only_fields = ["key"]

    def get_unit(self, k):
        return "money" if k.key == KpiType.Key.REVENUE else "count"

    def validate_stage(self, v):
        if v.kind == K.LOST:
            raise serializers.ValidationError("A KPI can't count records reaching Lost.")
        return v

    def validate(self, attrs):
        stage = attrs.get("stage", self.instance.stage if self.instance else None)
        if attrs.get("verified_only", self.instance.verified_only if self.instance else False) and stage and stage.kind != K.WON:
            raise serializers.ValidationError({"verified_only": "Only wins are verified: bind this KPI to a Won stage, or switch this off."})
        return attrs


class StageEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = StageEvent
        fields = ["id", "from_stage", "to_stage", "day", "backward", "baseline", "review", "review_note"]


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
