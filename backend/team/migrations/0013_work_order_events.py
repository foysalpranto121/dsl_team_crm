"""SRS v0.5 D2, §12.1: Work Order Receiving is event-based and verified. Hours already logged with it stay as they are."""
from django.db import migrations


def to_events(apps, schema_editor):
    apps.get_model("team", "Task").objects.filter(name__icontains="work order").update(scoring_mode="event")


def back(apps, schema_editor):
    apps.get_model("team", "Task").objects.filter(scoring_mode="event").update(scoring_mode="time")


class Migration(migrations.Migration):

    dependencies = [("team", "0012_task_scoring_mode")]

    operations = [migrations.RunPython(to_events, back)]
