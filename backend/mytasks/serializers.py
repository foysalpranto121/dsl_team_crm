from rest_framework import serializers

from team import services as team

from . import services
from .models import PersonalTask


class TaskSerializer(serializers.ModelSerializer):
    """`due` takes natural text ("tomorrow", "Sun", "15 Nov"); due_date takes a date. Neither = today."""

    due = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=40)
    client_name = serializers.SerializerMethodField()
    activity_name = serializers.SerializerMethodField()
    activity_points = serializers.SerializerMethodField()
    assigned_by_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = PersonalTask
        fields = ["id", "title", "due", "due_date", "due_time", "priority", "client", "client_name", "activity", "activity_name", "activity_points",
                  "status", "status_label", "drop_reason", "repeat", "assigned_by_name", "done_at", "logged_day", "logged_hour", "overdue", "created_at"]
        read_only_fields = ["status", "drop_reason", "done_at", "logged_day", "logged_hour", "created_at"]
        extra_kwargs = {"due_date": {"required": False}}

    def get_client_name(self, t):
        return t.client.company if t.client else None

    def get_activity_name(self, t):
        return t.activity.name if t.activity else None

    def get_activity_points(self, t):
        return float(t.activity.points) if t.activity else None

    def get_assigned_by_name(self, t):
        return (t.assigned_by.name or t.assigned_by.email) if t.assigned_by else None

    def get_overdue(self, t):
        return t.status == PersonalTask.Status.OPEN and t.due_date < self.context["today"]

    def validate_title(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Write what the task is.")
        return value

    def validate_client(self, value):
        if value and value.owner_id != self.context["request"].user.pk:
            raise serializers.ValidationError("Choose one of your own pipeline records.")
        return value

    def validate_activity(self, value):
        if value and not value.active:
            raise serializers.ValidationError("That activity is switched off.")
        return value

    def validate(self, attrs):
        text = attrs.pop("due", None)
        if text is not None and text.strip():
            try:
                attrs["due_date"] = services.parse_when(text, self.context["today"])
            except services.TaskError as e:
                raise serializers.ValidationError({"due": str(e)})
        if self.instance is None and "due_date" not in attrs:
            attrs["due_date"] = self.context["today"]
        if self.instance is not None and self.instance.assigned_by_id and ({"title", "activity"} & attrs.keys()):
            raise serializers.ValidationError({"title": "An assigned task's title and activity are set by the person who assigned it."})
        return attrs


def context_for(request):
    return {"request": request, "today": team.today()}
