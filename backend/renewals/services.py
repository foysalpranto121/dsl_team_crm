"""AMC and renewal tracker (SRS v0.3 §14.6): who sees which contracts, opening renewals at the reminder windows,
recording the outcome, the renewal dashboard, and the renewal revenue that counts in the Revenue KPI.

Visibility: admins and management (viewers) see every contract; members see the contracts they own. Only the account
owner or an admin works a renewal.
"""
from collections import Counter, defaultdict
from datetime import timedelta

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Q

from accounts.models import User
from accounts.services import photo_of
from core import audit
from team import calc
from team import services as team
from team.models import Sheet, TeamSettings

from .models import Contract, Renewal, RenewalSettings

OPEN = Contract.Status.OPEN
OPEN_STAGES = Renewal.OPEN_STAGES
UPSELL_LIMIT = 8
HUDDLE_LIMIT = 6


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


class Invalid(Exception):
    """The change doesn't make sense as asked (HTTP 400). The message says why."""


# ---------- who sees what ----------

def sees_all(user):
    return user.is_approved and user.role in (User.Role.ADMIN, User.Role.VIEWER)


def contracts_for(user):
    qs = Contract.objects.select_related("owner__profile", "renewal", "next_term")
    return qs if sees_all(user) else qs.filter(owner=user)


def renewals_for(user):
    qs = Renewal.objects.select_related("contract__owner__profile", "credit_to", "closed_by")
    return qs if sees_all(user) else qs.filter(contract__owner=user)


def can_work(user, renewal):
    """The account owner (a member) or an admin may work a renewal. Management only reads."""
    return user.is_team_admin or (user.is_approved and user.role == User.Role.MEMBER and renewal.contract.owner_id == user.pk)


def person(user):
    return {"id": user.pk, "name": user.name or user.email, "email": user.email, "photo": photo_of(user)} if user else None


def name_of(user):
    return (user.name or user.email) if user else None


def renewal_of(contract):
    try:
        return contract.renewal
    except Renewal.DoesNotExist:
        return None


def next_term_of(contract):
    try:
        return contract.next_term
    except Contract.DoesNotExist:
        return None


def expected_value(contract):
    """What the renewal is worth: the renewal's value once it's open (the agreed value once renewed), else the contract's."""
    r = renewal_of(contract)
    return float(r.value if r else contract.value)


def state_of(contract, on, first_window):
    """active · due (inside the first window) · expired (ended, not renewed yet) · renewed · lost."""
    if contract.status != OPEN:
        return contract.status
    left = (contract.end_date - on).days
    return "expired" if left < 0 else "due" if left <= first_window else "active"


# ---------- opening renewals at the reminder windows (FR-RN2) ----------

def window_for(days_left, windows):
    """The smallest window the contract is inside (windows largest first), or None while it's outside the first."""
    inside = [w for w in windows if days_left <= w]
    return min(inside) if inside else None


def sync_contract(contract, on, windows):
    """Open the contract's renewal once it's inside the first window, assigned to the account owner. At each later window
    the renewal goes back on the owner's to-do list: its next step becomes due today."""
    if contract.status != OPEN:
        return None
    w = window_for((contract.end_date - on).days, windows)
    r = renewal_of(contract)
    if w is None:
        if r is not None and r.stage == Renewal.Stage.OPEN:   # the end date was corrected to later and nobody has started on it
            r.delete()
        return None
    if r is None:
        try:
            with transaction.atomic():
                return Renewal.objects.create(contract=contract, opened_on=on, window=w, value=contract.value, next_action_on=on,
                                              next_action=f"Contact {contract.client} about renewing {contract.product}"[:200])
        except IntegrityError:   # another request opened it at the same moment
            return Renewal.objects.get(contract=contract)
    if r.is_open and w != r.window:
        fields = ["window", "updated_at"]
        if w < r.window and (r.next_action_on is None or r.next_action_on > on):
            r.next_action_on = on
            fields.append("next_action_on")
        r.window = w
        r.save(update_fields=fields)
    return r


def sync(on=None, force=False):
    """Run the windows over every open contract. The renewal pages, the bell, the huddle and the digest call this, and it
    runs at most once an hour (so no scheduler is needed). force: run now, after the settings change."""
    on = on or team.today()
    if not force and not cache.add(f"renewals:sync:{on}", True, 3600):
        return
    windows = RenewalSettings.load().ordered_windows
    qs = (Contract.objects.filter(status=OPEN).filter(Q(end_date__lte=on + timedelta(days=windows[0])) | Q(renewal__stage=Renewal.Stage.OPEN))
          .select_related("owner", "renewal"))
    for c in qs:
        sync_contract(c, on, windows)


def after_contract_change(contract, old_value=None):
    """A contract was added, edited or imported: an open renewal still at the old value follows the new one, and the
    renewal opens (or closes again) at once instead of within the hour."""
    r = renewal_of(contract)
    if r is not None and r.is_open and old_value is not None and r.value == old_value and contract.value != old_value:
        r.value = contract.value
        r.save(update_fields=["value", "updated_at"])
    sync_contract(contract, team.today(), RenewalSettings.load().ordered_windows)


# ---------- working a renewal ----------

def _locked(renewal):
    # Lock the renewal and its contract; the owner (a nullable join) can't be locked and needn't be.
    return Renewal.objects.select_for_update(of=("self", "contract")).select_related("contract__owner").get(pk=renewal.pk)


def _check(user, r):
    if not can_work(user, r):
        raise NotAllowed("Only the account owner or an admin can change this renewal.")


@transaction.atomic
def update(user, renewal, data):
    r = _locked(renewal)
    _check(user, r)
    if not r.is_open:
        raise Invalid("This renewal is closed. An admin can reopen it.")
    before = {k: str(getattr(r, k)) for k in data}
    for k, v in data.items():
        setattr(r, k, v)
    if not r.next_action.strip() or r.next_action_on is None:
        raise Invalid("An open renewal needs a next step and a date for it.")
    r.save()
    audit.log(user, "renewal.update", r.contract, before=before, after={k: str(v) for k, v in data.items()})
    return r


@transaction.atomic
def renew(user, renewal, start, end, value, terms=None, on=None):
    """The client renewed: the contract closes as renewed and its next term starts as a new contract. The value counts in
    the owner's Revenue KPI in the week of `on` (FR-RN4)."""
    r = _locked(renewal)
    _check(user, r)
    if not r.is_open:
        raise Invalid("This renewal is already closed.")
    today = team.today()
    on = on or today
    if on > today:
        raise Invalid("The renewal date can't be in the future.")
    if on != today and not user.is_team_admin:
        raise Invalid("You can record a renewal for today. Ask an admin to record one for an earlier date.")
    if end < start:
        raise Invalid("The new term must end after it starts.")
    old = r.contract
    new = Contract.objects.create(client=old.client, product=old.product, kind=old.kind, start_date=start, end_date=end, value=value,
                                  terms=old.terms if terms is None else terms, owner=old.owner, previous=old, created_by=user)
    old.status = Contract.Status.RENEWED
    old.save(update_fields=["status", "updated_at"])
    r.stage, r.value, r.closed_on, r.closed_by, r.credit_to, r.next_action_on = Renewal.Stage.WON, value, on, user, old.owner, None
    r.save()
    audit.log(user, "renewal.won", old, value=str(value), until=str(end), on=str(on), owner=name_of(old.owner))
    sync_contract(new, today, RenewalSettings.load().ordered_windows)
    return r, new


@transaction.atomic
def lose(user, renewal, reason):
    r = _locked(renewal)
    _check(user, r)
    if not r.is_open:
        raise Invalid("This renewal is already closed.")
    r.stage, r.lost_reason, r.closed_on, r.closed_by, r.next_action_on = Renewal.Stage.LOST, reason, team.today(), user, None
    r.save()
    c = r.contract
    c.status = Contract.Status.LOST
    c.save(update_fields=["status", "updated_at"])
    audit.log(user, "renewal.lost", c, reason=reason, value=str(r.value))
    return r


@transaction.atomic
def reopen(user, renewal):
    """Undo a renewed or lost outcome recorded by mistake. A renewal also removes the next term it created."""
    if not user.is_team_admin:
        raise NotAllowed("Only admins can reopen a renewal.")
    r = _locked(renewal)
    if r.is_open:
        raise Invalid("This renewal is still open.")
    c, was = r.contract, r.stage
    if was == Renewal.Stage.WON:
        nxt = Contract.objects.filter(previous=c).select_related("renewal").first()
        if nxt is not None:
            nr = renewal_of(nxt)
            if nxt.status != OPEN or (nr is not None and nr.stage != Renewal.Stage.OPEN):
                raise Invalid("Its next term is already being renewed, so this can't be undone here. Change the next term instead.")
            nxt.delete()
    c.status = OPEN
    c.save(update_fields=["status", "updated_at"])
    r.stage, r.next_action_on, r.lost_reason = Renewal.Stage.TALKING, team.today(), ""
    r.closed_on = r.closed_by = r.credit_to = None
    r.next_action = r.next_action or f"Follow up with {c.client} about the renewal"[:200]
    r.save()
    audit.log(user, "renewal.reopen", c, flagged=True, was=was)
    return r


# ---------- renewal revenue in the Revenue KPI (FR-RN4) ----------

def sheet_by_owner():
    """Each person's work sheet (the first one if they have several). Their renewal revenue counts there."""
    out = {}
    rows = Sheet.objects.filter(kind=Sheet.Kind.WORK, archived=False, owner__isnull=False).order_by("position", "id").values_list("id", "owner_id")
    for sheet_id, owner_id in rows:
        out.setdefault(owner_id, sheet_id)
    return out


def revenue_by_sheet_week(cfg):
    """{(sheet id, week start): amount}: each won renewal's value times the revenue weight, in the week it was renewed, on
    the work sheet of the person it's credited to."""
    weight = float(RenewalSettings.load().revenue_weight)
    if weight <= 0:
        return {}
    won = list(Renewal.objects.filter(stage=Renewal.Stage.WON, credit_to__isnull=False, closed_on__isnull=False)
               .values_list("credit_to_id", "closed_on", "value"))
    if not won:
        return {}
    sheets, out = sheet_by_owner(), defaultdict(float)
    for owner_id, day, value in won:
        if owner_id in sheets:
            out[(sheets[owner_id], calc.week_start_of(day, cfg))] += float(value) * weight / 100
    return {k: calc.r2(v) for k, v in out.items()}


# ---------- dashboard (FR-RN3) ----------

def _total(renewals):
    return {"count": len(renewals), "value": calc.r2(sum(float(r.value) for r in renewals))}


def renewal_rate(contracts, on):
    """Over the last 12 months: of the contracts that came up for renewal (their term ended, or the renewal was decided, in
    that time), the share that renewed, by count and by value. Ended contracts not decided yet count as not renewed (yet)."""
    since = on - timedelta(days=365)
    came = []
    for c in contracts:
        r = renewal_of(c)
        decided = r is not None and not r.is_open and r.closed_on is not None and since <= r.closed_on <= on
        if decided or since <= c.end_date <= on:
            came.append(c)
    renewed = [c for c in came if c.status == Contract.Status.RENEWED]
    lost = [c for c in came if c.status == Contract.Status.LOST]
    value = sum(float(c.value) for c in came)
    return {"came_up": len(came), "renewed": len(renewed), "lost": len(lost), "pending": len(came) - len(renewed) - len(lost),
            "rate": len(renewed) / len(came) if came else None,
            "value_rate": sum(float(c.value) for c in renewed) / value if value else None,
            "renewed_value": calc.r2(sum(expected_value(c) for c in renewed)),
            "lost_value": calc.r2(sum(float(c.value) for c in lost))}


def _key(text):
    return " ".join(text.split()).casefold()


def upsell(open_renewals, on, first_window):
    """Upsell ideas for renewals coming up: the owner's note, plus products other clients have that this client doesn't
    (whitespace). An idea says how many clients have the product, never which ones."""
    held, label = defaultdict(set), {}
    for client, product in Contract.objects.exclude(status=Contract.Status.LOST).values_list("client", "product"):
        held[_key(client)].add(_key(product))
        label.setdefault(_key(product), product)
    popular = Counter(p for products in held.values() for p in products).most_common()
    items = []
    for r in sorted(open_renewals, key=lambda x: x.contract.end_date):
        c = r.contract
        if (c.end_date - on).days > first_window:
            continue
        have = held.get(_key(c.client), set())
        ideas = [{"product": label[p], "clients": n} for p, n in popular if p not in have and n >= 2][:3]
        if ideas or r.upsell:
            items.append({"renewal": r.id, "client": c.client, "product": c.product, "end_date": c.end_date, "note": r.upsell, "ideas": ideas})
    return items[:UPSELL_LIMIT]


def summary(user, on=None):
    st = TeamSettings.load()
    on = on or team.today(st)
    sync(on)
    rs = RenewalSettings.load()
    windows = rs.ordered_windows
    first, last = windows[0], windows[-1]
    contracts = list(contracts_for(user))
    open_renewals = [r for c in contracts if c.status == OPEN and (r := renewal_of(c)) is not None and r.is_open]

    months = [calc.add_months(calc.month_start(on), i) for i in range(12)]
    by_month = {(m.year, m.month): {"month": f"{m:%Y-%m}", "open": 0.0, "renewed": 0.0, "lost": 0.0, "count": 0} for m in months}
    for c in contracts:
        b = by_month.get((c.end_date.year, c.end_date.month))
        if b is not None:
            b[c.status] += expected_value(c)
            b["count"] += 1
    for b in by_month.values():
        b.update({k: calc.r2(b[k]) for k in ("open", "renewed", "lost")})

    left = lambda r: (r.contract.end_date - on).days  # noqa: E731
    upcoming = [r for r in open_renewals if 0 <= left(r) <= first]
    expired = [r for r in open_renewals if left(r) < 0]
    at_risk = expired + [r for r in upcoming if left(r) <= last]
    month_start = calc.month_start(on)
    renewed_month = [r for c in contracts if (r := renewal_of(c)) is not None and r.stage == Renewal.Stage.WON and r.closed_on and r.closed_on >= month_start]

    warnings = {}
    if user.is_team_admin:
        warnings["unowned"] = sum(1 for c in contracts if c.status == OPEN and c.owner_id is None)
        sheets = sheet_by_owner() if rs.revenue_weight > 0 else None
        warnings["no_sheet"] = sorted({name_of(c.owner) for c in contracts if c.status == OPEN and c.owner_id and c.owner_id not in sheets}) if sheets is not None else []

    return {
        "today": on, "windows": windows, "revenue_weight": float(rs.revenue_weight), "scope": "all" if sees_all(user) else "mine",
        "contracts": {"total": len(contracts), "open": sum(1 for c in contracts if c.status == OPEN)},
        "upcoming": {**_total(upcoming), "days": first},
        "at_risk": {**_total(at_risk), "days": last, "expired": _total(expired)},
        "renewed_month": {**_total(renewed_month), "month": f"{on:%B}"},
        "rate": renewal_rate(contracts, on),
        "by_month": list(by_month.values()),
        "stages": [{"stage": s, "label": label, **_total([r for r in open_renewals if r.stage == s])} for s, label in Renewal.Stage.choices if s in OPEN_STAGES],
        "upsell": upsell(open_renewals, on, first),
        "warnings": warnings,
    }


# ---------- the to-do list, the huddle and the digest ----------

def due_for(user, on=None):
    """The person's renewals whose next step is due today or overdue: their to-do (FR-RN2, "shown as Next Steps")."""
    on = on or team.today()
    sync(on)
    qs = (Renewal.objects.filter(stage__in=OPEN_STAGES, contract__owner=user).filter(Q(next_action_on__isnull=True) | Q(next_action_on__lte=on))
          .select_related("contract").order_by("contract__end_date", "id"))
    rows = list(qs)
    items = [{"id": r.id, "client": r.contract.client, "product": r.contract.product, "end_date": r.contract.end_date,
              "days_left": (r.contract.end_date - on).days, "next_action": r.next_action, "next_action_on": r.next_action_on,
              "overdue": bool(r.next_action_on and r.next_action_on < on)} for r in rows[:20]]
    unowned = Renewal.objects.filter(stage__in=OPEN_STAGES, contract__owner__isnull=True).count() if user.is_team_admin else None
    return {"items": items, "count": len(rows), "unowned": unowned}


def huddle_block(user, on):
    """Open renewals ending within the last reminder window (30 days by default) or already ended. Admins see them all, with
    owners; everyone else sees their own."""
    sync(on)
    days = RenewalSettings.load().ordered_windows[-1]
    qs = (Renewal.objects.filter(stage__in=OPEN_STAGES, contract__end_date__lte=on + timedelta(days=days))
          .select_related("contract__owner").order_by("contract__end_date", "id"))
    if not user.is_team_admin:
        qs = qs.filter(contract__owner=user)
    rows = list(qs)
    return {"days": days, "total": len(rows), "expired": sum(1 for r in rows if r.contract.end_date < on),
            "items": [{"id": r.id, "client": r.contract.client, "product": r.contract.product, "days_left": (r.contract.end_date - on).days,
                       "stage": r.get_stage_display(), "owner": name_of(r.contract.owner)} for r in rows[:HUDDLE_LIMIT]]}


def digest_block(week_start, week_end):
    """For the weekly management digest: renewed and lost that week, what ends soon, what ended without renewal, and the
    12-month renewal rate. None when the team keeps no contracts."""
    if not Contract.objects.exists():
        return None
    sync()
    days = RenewalSettings.load().ordered_windows[-1]
    closed = list(Renewal.objects.filter(closed_on__range=(week_start, week_end)).exclude(stage__in=OPEN_STAGES).select_related("contract"))
    open_ = list(Renewal.objects.filter(stage__in=OPEN_STAGES, contract__end_date__lte=week_end + timedelta(days=days))
                 .select_related("contract__owner").order_by("contract__end_date", "id"))
    ended = [r for r in open_ if r.contract.end_date <= week_end]
    coming = [r for r in open_ if r.contract.end_date > week_end]
    lost = [r for r in closed if r.stage == Renewal.Stage.LOST]
    return {
        "renewed": _total([r for r in closed if r.stage == Renewal.Stage.WON]),
        "lost": {**_total(lost), "reasons": [f"{r.contract.client}: {r.lost_reason}" for r in lost[:5]]},
        "ended": _total(ended),
        "coming": {**_total(coming), "days": days,
                   "items": [{"client": r.contract.client, "product": r.contract.product, "end_date": r.contract.end_date, "value": float(r.value),
                              "owner": name_of(r.contract.owner), "stage": r.get_stage_display()} for r in coming[:6]]},
        "rate": renewal_rate(list(Contract.objects.select_related("renewal")), week_end),
    }
