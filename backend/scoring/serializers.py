from rest_framework import serializers

from team.models import Sheet, Task
from team.planning import person_of

from . import services
from .models import EventLog


class EventSerializer(serializers.ModelSerializer):
    activity_name = serializers.CharField(source="activity.name", read_only=True)
    person = serializers.SerializerMethodField()
    points = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    decided_by_name = serializers.SerializerMethodField()
    company = serializers.SerializerMethodField()
    mine = serializers.SerializerMethodField()

    class Meta:
        model = EventLog
        fields = ["id", "sheet", "person", "day", "activity", "activity_name", "quantity", "points", "evidence", "note", "status", "status_label",
                  "decided_by_name", "decided_at", "decision_note", "record", "company", "mine", "created_at"]

    def get_person(self, e):
        return person_of(e.sheet)

    def get_points(self, e):
        """What it earns: the ledger's value once verified, otherwise what it would earn on its date."""
        book = self.context.get("book") or services.Book()
        return services.calc.r2(e.quantity * book.rate(e.day, e.activity_id, e.activity.points))

    def get_decided_by_name(self, e):
        return (e.decided_by.name or e.decided_by.email) if e.decided_by else None

    def get_company(self, e):
        return e.record.company if e.record else None

    def get_mine(self, e):
        req = self.context.get("request")
        return bool(req and e.sheet.owner_id == req.user.pk)


class EventWriteSerializer(serializers.Serializer):
    sheet = serializers.PrimaryKeyRelatedField(queryset=Sheet.objects.all())
    day = serializers.DateField()
    activity = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all())
    quantity = serializers.IntegerField(min_value=1, max_value=1000, default=1)
    evidence = serializers.CharField(max_length=300)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
