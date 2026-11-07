from rest_framework import serializers

from accounts.models import User

from . import services
from .models import Contract, Renewal, RenewalSettings

OPEN_STAGE_CHOICES = [(s, label) for s, label in Renewal.Stage.choices if s in Renewal.OPEN_STAGES]


def renewal_brief(r):
    if r is None:
        return None
    return {"id": r.id, "stage": r.stage, "stage_label": r.get_stage_display(), "value": str(r.value), "next_action": r.next_action,
            "next_action_on": r.next_action_on, "closed_on": r.closed_on}


class ContractSerializer(serializers.ModelSerializer):
    """Context: `on` (today in the team's time zone) and `first_window` (days)."""

    owner = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(status=User.Status.APPROVED, is_active=True, role__in=[User.Role.ADMIN, User.Role.SUPERVISOR, User.Role.MEMBER]),
        allow_null=True, required=False)
    owner_info = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    state = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()
    renewal = serializers.SerializerMethodField()
    next_term = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = ["id", "client", "product", "kind", "kind_label", "start_date", "end_date", "value", "terms", "owner", "owner_info",
                  "status", "status_label", "state", "days_left", "external_id", "notes", "previous", "next_term", "renewal",
                  "created_at", "updated_at"]
        read_only_fields = ["status", "previous", "created_at", "updated_at"]
        # The unique external ID is checked in validate_external_id, in plain words (it may be empty on many contracts).
        extra_kwargs = {"external_id": {"validators": []}}

    def get_owner_info(self, c):
        return services.person(c.owner)

    def get_state(self, c):
        return services.state_of(c, self.context["on"], self.context["first_window"])

    def get_days_left(self, c):
        return (c.end_date - self.context["on"]).days

    def get_renewal(self, c):
        return renewal_brief(services.renewal_of(c))

    def get_next_term(self, c):
        nxt = services.next_term_of(c)
        return {"id": nxt.id, "start_date": nxt.start_date, "end_date": nxt.end_date} if nxt else None

    def _text(self, value, what):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError(f"Enter the {what}.")
        return value

    def validate_client(self, value):
        return self._text(value, "client's name")

    def validate_product(self, value):
        return self._text(value, "product or service")

    def validate_external_id(self, value):
        value = value.strip()
        if value and Contract.objects.filter(external_id=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("Another contract already has this ID.")
        return value

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "The contract must end on or after its start date."})
        return attrs


class RenewalSerializer(serializers.ModelSerializer):
    """Context: `on` (today) and `request`."""

    stage_label = serializers.CharField(source="get_stage_display", read_only=True)
    contract = serializers.SerializerMethodField()
    closed_by = serializers.SerializerMethodField()
    credit_to = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()
    due = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Renewal
        fields = ["id", "contract", "stage", "stage_label", "opened_on", "window", "value", "next_action", "next_action_on", "upsell",
                  "lost_reason", "closed_on", "closed_by", "credit_to", "days_left", "due", "can_edit", "updated_at"]
        read_only_fields = fields

    def get_contract(self, r):
        c = r.contract
        return {"id": c.id, "client": c.client, "product": c.product, "kind": c.kind, "kind_label": c.get_kind_display(),
                "start_date": c.start_date, "end_date": c.end_date, "value": str(c.value), "terms": c.terms, "notes": c.notes,
                "external_id": c.external_id, "owner": services.person(c.owner)}

    def get_closed_by(self, r):
        return services.name_of(r.closed_by)

    def get_credit_to(self, r):
        return services.name_of(r.credit_to)

    def get_days_left(self, r):
        return (r.contract.end_date - self.context["on"]).days

    def get_due(self, r):
        """overdue · today · later · None (closed)."""
        if not r.is_open:
            return None
        on = self.context["on"]
        if r.next_action_on is None or r.next_action_on == on:
            return "today"
        return "overdue" if r.next_action_on < on else "later"

    def get_can_edit(self, r):
        return services.can_work(self.context["request"].user, r)


class RenewalUpdateSerializer(serializers.Serializer):
    stage = serializers.ChoiceField(choices=OPEN_STAGE_CHOICES, required=False)
    next_action = serializers.CharField(max_length=200, required=False, allow_blank=True)
    next_action_on = serializers.DateField(required=False, allow_null=True)
    value = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, required=False)
    upsell = serializers.CharField(max_length=300, required=False, allow_blank=True)


class RenewSerializer(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    value = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    terms = serializers.CharField(max_length=300, required=False, allow_blank=True)
    renewed_on = serializers.DateField(required=False, help_text="The day the client agreed (admins only; default today).")


class LoseSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=200)


class RenewalSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = RenewalSettings
        fields = ["windows", "revenue_weight", "updated_at"]
        read_only_fields = ["updated_at"]

    def validate_windows(self, value):
        return sorted(value, reverse=True)
