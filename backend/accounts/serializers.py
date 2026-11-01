from io import BytesIO

from django.conf import settings
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.utils import timezone
from PIL import Image, ImageOps
from rest_framework import serializers

from .models import Profile, User


class ProfileSerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()
    is_complete = serializers.BooleanField(read_only=True)
    remove_photo = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = Profile
        fields = ["photo", "photo_url", "remove_photo", "position", "job_description", "official_email", "phone", "bio",
                  "is_complete", "completed_at", "updated_at"]
        read_only_fields = ["completed_at", "updated_at"]
        extra_kwargs = {"photo": {"write_only": True, "required": False}}

    def get_photo_url(self, obj):
        if obj.photo:   # a relative /media/... address: the site forwards it to the API, wherever that runs
            return obj.photo.url
        return obj.user.google_picture or None

    def validate_photo(self, f):
        if f.size > settings.PROFILE_PHOTO_MAX_BYTES:
            raise serializers.ValidationError("The photo must be 3 MB or smaller.")
        try:
            img = Image.open(f)
            img = ImageOps.exif_transpose(img).convert("RGB")
        except Exception:
            raise serializers.ValidationError("Upload a JPG, PNG or WebP image.")
        img.thumbnail((512, 512))  # profile photos never need more; keeps storage small
        out = BytesIO()
        img.save(out, format="JPEG", quality=88)
        return InMemoryUploadedFile(out, "photo", "photo.jpg", "image/jpeg", out.tell(), None)

    def validate(self, attrs):
        for f in ("position", "job_description", "bio", "phone"):
            if f in attrs:
                attrs[f] = attrs[f].strip()
        return attrs

    def update(self, instance, validated):
        if validated.pop("remove_photo", False) and instance.photo:
            instance.photo.delete(save=False)
        old = instance.photo.name if instance.photo and "photo" in validated else None
        instance = super().update(instance, validated)
        if old and old != instance.photo.name:
            instance.photo.storage.delete(old)
        if instance.is_complete and not instance.completed_at:
            instance.completed_at = timezone.now()
            instance.save(update_fields=["completed_at"])
        return instance


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "name", "status", "role", "requested_at", "approved_at", "profile"]
        read_only_fields = fields


class MeSerializer(UserSerializer):
    """The signed-in person. They may change their display name; everything else is admin-managed."""

    class Meta(UserSerializer.Meta):
        read_only_fields = ["id", "email", "status", "role", "requested_at", "approved_at", "profile"]


class AdminUserSerializer(UserSerializer):
    """What admins can change about someone: their role, and whether they are still allowed in."""

    approved_by = serializers.StringRelatedField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["approved_by", "last_login"]
        read_only_fields = ["id", "email", "requested_at", "approved_at", "approved_by", "last_login", "profile"]

    def validate_status(self, v):
        if v == User.Status.PENDING:
            raise serializers.ValidationError("Use approve or reject instead.")
        return v

    def validate(self, attrs):
        me, target = self.context["request"].user, self.instance
        demoting = attrs.get("role", target.role) != User.Role.ADMIN or attrs.get("status", target.status) != User.Status.APPROVED
        if target.role == User.Role.ADMIN and demoting:
            others = User.objects.filter(role=User.Role.ADMIN, status=User.Status.APPROVED, is_active=True).exclude(pk=target.pk)
            if not others.exists():
                raise serializers.ValidationError("The team needs at least one admin. Make someone else admin first.")
        if target.pk == me.pk and demoting:
            raise serializers.ValidationError("You can't remove your own admin access. Ask another admin.")
        return attrs


class GoogleSignInSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=4096)


class DecisionSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=User.Role.choices, default=User.Role.MEMBER)
