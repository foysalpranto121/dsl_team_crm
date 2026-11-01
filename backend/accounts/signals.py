from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile, User


@receiver(post_save, sender=User)
def create_profile(sender, instance, created, raw=False, **kwargs):
    if created and not raw:   # raw: loading saved data (loaddata), which brings its own profiles
        Profile.objects.get_or_create(user=instance, defaults={"official_email": instance.email})
