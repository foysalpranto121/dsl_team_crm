from django.contrib import admin

from .models import Contract, Renewal, RenewalSettings


@admin.register(Contract)
class ContractAdmin(admin.ModelAdmin):
    list_display = ("client", "product", "kind", "end_date", "value", "owner", "status")
    list_filter = ("status", "kind")
    search_fields = ("client", "product", "external_id")
    raw_id_fields = ("owner", "previous", "created_by")


@admin.register(Renewal)
class RenewalAdmin(admin.ModelAdmin):
    list_display = ("contract", "stage", "window", "value", "next_action_on", "closed_on")
    list_filter = ("stage",)
    raw_id_fields = ("contract", "closed_by", "credit_to")


admin.site.register(RenewalSettings)
