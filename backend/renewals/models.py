"""AMC and renewal tracker (SRS v0.3 §14.6).

Contract: something sold that ends and can be renewed — software, a licence, an AMC (FR-RN1).
Renewal: the renewal opportunity for one contract term (the SRS's RenewalOpportunity). It opens by itself when the contract
comes inside the first reminder window (90 days by default) and goes back on the owner's to-do list at each later window
(60 and 30 days) (FR-RN2). A won renewal counts in the owner's Revenue KPI, at the share set in the settings (FR-RN4).
"""
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q

User = settings.AUTH_USER_MODEL
DEFAULT_WINDOWS = (90, 60, 30)


def default_windows():
    return list(DEFAULT_WINDOWS)


def validate_windows(value):
    ok = (isinstance(value, list) and 1 <= len(value) <= 5 and len(set(value)) == len(value)
          and all(isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 365 for d in value))
    if not ok:
        raise ValidationError("Use 1 to 5 different numbers of days between 1 and 365, e.g. 90, 60, 30.")


def money():
    return models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"), validators=[MinValueValidator(0)])


class RenewalSettings(models.Model):
    """One row."""

    windows = models.JSONField(default=default_windows, validators=[validate_windows],
                               help_text="Days before a contract ends: the first opens its renewal, each later one reminds the owner again.")
    revenue_weight = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("100"),
                                         validators=[MinValueValidator(0), MaxValueValidator(100)],
                                         help_text="Share of a renewal's value that counts in the owner's Revenue KPI. 0 = renewals don't count.")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "renewal settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def ordered_windows(self):
        """Largest first, e.g. [90, 60, 30]."""
        return sorted(self.windows, reverse=True)


class Contract(models.Model):
    class Kind(models.TextChoices):
        AMC = "amc", "AMC (maintenance)"
        LICENCE = "licence", "Licence or subscription"
        SOFTWARE = "software", "Software"
        SUPPORT = "support", "Support"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RENEWED = "renewed", "Renewed"
        LOST = "lost", "Not renewed"

    client = models.CharField(max_length=200, db_index=True)
    product = models.CharField(max_length=120)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.AMC)
    start_date = models.DateField()
    end_date = models.DateField(db_index=True)
    value = money()
    terms = models.CharField(max_length=300, blank=True, help_text="Renewal terms, e.g. yearly, 10% increase, 30 days' notice.")
    owner = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="contracts",
                              help_text="Account owner: works the renewal and gets the credit for it.")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN, db_index=True)
    previous = models.OneToOneField("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="next_term",
                                    help_text="The contract this one renews.")
    external_id = models.CharField(max_length=80, blank=True,
                                   help_text="Its ID in Odoo or the old records, so importing again updates it instead of adding a copy.")
    notes = models.TextField(max_length=2000, blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["end_date", "client", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(end_date__gte=F("start_date")), name="contract_ends_on_or_after_start"),
            models.UniqueConstraint(fields=["external_id"], condition=~Q(external_id=""), name="unique_contract_external_id"),
        ]

    def __str__(self):
        return f"{self.client} · {self.product}"


class Renewal(models.Model):
    """The renewal opportunity for one contract term."""

    class Stage(models.TextChoices):
        OPEN = "open", "To contact"
        TALKING = "talking", "In talks"
        QUOTED = "quoted", "Quote sent"
        WON = "won", "Renewed"
        LOST = "lost", "Not renewing"

    OPEN_STAGES = (Stage.OPEN, Stage.TALKING, Stage.QUOTED)

    contract = models.OneToOneField(Contract, on_delete=models.CASCADE, related_name="renewal")
    stage = models.CharField(max_length=8, choices=Stage.choices, default=Stage.OPEN, db_index=True)
    opened_on = models.DateField()
    window = models.PositiveSmallIntegerField(help_text="The latest reminder window reached, in days before the contract ends.")
    value = money()
    next_action = models.CharField(max_length=200, blank=True)
    next_action_on = models.DateField(null=True, blank=True, db_index=True)
    upsell = models.CharField(max_length=300, blank=True, help_text="An upgrade or extra modules to offer with the renewal.")
    lost_reason = models.CharField(max_length=200, blank=True)
    closed_on = models.DateField(null=True, blank=True, db_index=True)
    closed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    credit_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="renewals_won",
                                  help_text="Whose Revenue KPI the renewal counts in: the account owner when it was renewed.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["contract__end_date", "id"]

    def __str__(self):
        return f"Renewal of {self.contract}"

    @property
    def is_open(self):
        return self.stage in self.OPEN_STAGES
