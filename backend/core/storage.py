"""Uploaded files (profile photos) kept in the database instead of on disk.

The free hosting plan wipes the server's disk on every restart, so files there would vanish; the database keeps them.
Files are served by core.views.media at MEDIA_URL.
"""
from urllib.parse import quote

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class DatabaseStorage(Storage):
    def _model(self):
        from .models import StoredFile   # imported late: storages load before apps are ready
        return StoredFile

    def _open(self, name, mode="rb"):
        row = self._model().objects.filter(name=name).first()
        if row is None:
            raise FileNotFoundError(name)
        return ContentFile(bytes(row.content), name=name)

    def _save(self, name, content):
        if hasattr(content, "seek"):
            content.seek(0)
        data = b"".join(content.chunks())
        self._model().objects.update_or_create(name=name, defaults={"content": data, "size": len(data)})
        return name

    def exists(self, name):
        return self._model().objects.filter(name=name).exists()

    def delete(self, name):
        self._model().objects.filter(name=name).delete()

    def size(self, name):
        row = self._model().objects.filter(name=name).only("size").first()
        if row is None:
            raise FileNotFoundError(name)
        return row.size

    def url(self, name):
        return settings.MEDIA_URL + quote(name)
