"""Copy profile photos uploaded before files moved into the database (from backend/media/). Files on disk are left alone."""
from django.conf import settings
from django.db import migrations


def copy_photos(apps, schema_editor):
    Profile, StoredFile = apps.get_model("accounts", "Profile"), apps.get_model("core", "StoredFile")
    root = settings.MEDIA_ROOT
    for name in Profile.objects.exclude(photo="").values_list("photo", flat=True):
        path = root / name
        if path.is_file() and not StoredFile.objects.filter(name=name).exists():
            data = path.read_bytes()
            StoredFile.objects.create(name=name, content=data, size=len(data))


class Migration(migrations.Migration):
    dependencies = [("core", "0003_stored_files"), ("accounts", "0001_initial")]
    operations = [migrations.RunPython(copy_photos, migrations.RunPython.noop)]
