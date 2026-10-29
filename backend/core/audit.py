from .models import AuditLog


def log(actor, action, target="", flagged=False, **detail):
    AuditLog.objects.create(actor=actor if getattr(actor, "pk", None) else None, action=action, target=str(target)[:200],
                            detail=detail, flagged=flagged)
