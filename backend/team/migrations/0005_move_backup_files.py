"""Copy backups saved before they moved into the database (from backend/snapshots/*.json). Files on disk are left alone."""
import json
from datetime import datetime

from django.conf import settings
from django.db import migrations


def copy_backups(apps, schema_editor):
    Backup = apps.get_model("team", "Backup")
    folder = settings.BASE_DIR / "snapshots"
    if not folder.is_dir():
        return
    for path in folder.glob("*.json"):
        if Backup.objects.filter(name=path.name).exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            Backup.objects.create(name=path.name, created=datetime.fromisoformat(data["created"]), reason=data["reason"],
                                  counts=data["counts"], data=data)
        except (ValueError, KeyError):
            continue   # not a backup file


class Migration(migrations.Migration):
    dependencies = [("team", "0004_stored_files")]
    operations = [migrations.RunPython(copy_backups, migrations.RunPython.noop)]
