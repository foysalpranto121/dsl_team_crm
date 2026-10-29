import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra):
        if not email:
            raise ValueError("An email address is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()  # people sign in with Google
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, status=User.Status.APPROVED, role=User.Role.ADMIN)
        extra.setdefault("approved_at", timezone.now())
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        DISABLED = "disabled", "Disabled"

    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"
        VIEWER = "viewer", "Viewer"

    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150, blank=True)
    google_sub = models.CharField(max_length=64, unique=True, null=True, blank=True)
    google_picture = models.URLField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    requested_at = models.DateTimeField(default=timezone.now)
    approved_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Can open the Django admin site.")
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        ordering = ["name", "email"]

    def __str__(self):
        return self.name or self.email

    def save(self, *args, **kwargs):
        self.email = (self.email or "").strip().lower()
        super().save(*args, **kwargs)

    @property
    def is_approved(self):
        return self.is_active and self.status == self.Status.APPROVED

    @property
    def is_team_admin(self):
        return self.is_approved and self.role == self.Role.ADMIN


def photo_path(instance, filename):
    return f"profiles/{instance.user_id}/{uuid.uuid4().hex}.jpg"


phone_validator = RegexValidator(r"^\+?[0-9 ()\-]{6,20}$", "Enter a phone number like +880 1712 345678.")


class Profile(models.Model):
    REQUIRED = ("position", "job_description", "official_email", "phone")

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    photo = models.ImageField(upload_to=photo_path, blank=True)
    position = models.CharField(max_length=120, blank=True)
    job_description = models.TextField(max_length=2000, blank=True)
    official_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True, validators=[phone_validator])
    bio = models.TextField(max_length=1000, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile of {self.user}"

    @property
    def is_complete(self):
        return all(str(getattr(self, f) or "").strip() for f in self.REQUIRED)
