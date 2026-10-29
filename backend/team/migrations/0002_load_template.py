# Loads the starting task list and job roles (from the DSL Team Operation Sheet) on a fresh database.
from django.db import migrations


def load(apps, schema_editor):
    from team import template
    template.load(apps.get_model("team", "Task"), apps.get_model("team", "JobRole"), apps.get_model("team", "TeamSettings"))


class Migration(migrations.Migration):

    dependencies = [
        ('team', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(load, migrations.RunPython.noop),
    ]
