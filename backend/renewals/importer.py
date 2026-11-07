"""Contracts from a CSV file (FR-RN1): the old records, or an export from Odoo.

The first row holds the column names; common names are recognised (Customer, Expiry date, Amount, Salesperson…). A row
that matches a contract already here updates it instead of adding a copy: by external ID when the file has one, otherwise
by client, product and start date. Rows with problems are skipped and listed; the rest go in.
"""
import csv
import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction

from accounts.models import User
from core import audit

from . import services
from .models import Contract

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
FIELDS = {
    "client": ("client", "customer", "company", "partner", "client name", "customer name"),
    "product": ("product", "service", "item", "product name", "description"),
    "kind": ("kind", "type", "contract type"),
    "start_date": ("start", "start date", "starts", "from", "date start", "contract start"),
    "end_date": ("end", "end date", "ends", "expiry", "expiry date", "expires", "expiration date", "date end", "contract end", "renewal date"),
    "value": ("value", "amount", "contract value", "price", "total", "annual value"),
    "terms": ("terms", "renewal terms"),
    "owner": ("owner", "owner email", "account owner", "salesperson", "responsible", "assigned to"),
    "external_id": ("id", "external id", "reference", "ref", "contract id", "contract no", "contract number"),
    "notes": ("notes", "note", "remarks"),
}
LABELS = {"client": "Client", "product": "Product", "end_date": "End date"}
REQUIRED = ("client", "product", "end_date")
MONTH_FORMATS = ("%d %b %Y", "%d %B %Y", "%b %d %Y", "%B %d %Y", "%d-%b-%Y", "%d-%b-%y")


class BadFile(Exception):
    """The whole file can't be read; the message says why."""


def _norm(header):
    return " ".join(header.replace("_", " ").replace("-", " ").strip().lower().split())


def _key(text):
    return " ".join(text.split()).casefold()


def parse_date(text):
    s = text.strip()
    if not s:
        return None
    try:
        if m := re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s):              # 2026-12-31, also with a time after it (Odoo)
            return date(int(m[1]), int(m[2]), int(m[3]))
        if m := re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$", s):    # 31/12/2026: day first, as written in Bangladesh
            return date(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        raise ValueError(f"“{s}” isn't a real date.") from None
    for fmt in MONTH_FORMATS:
        try:
            return datetime.strptime(s.replace(",", ""), fmt).date()
        except ValueError:
            pass
    raise ValueError(f"“{s}” isn't a date. Use 2026-12-31 or 31/12/2026.")


def parse_money(text):
    """(amount, was it empty). Takes 1,20,000 · BDT 120000 · ৳1.2 lakh is not understood (write the number)."""
    t = re.sub(r"(?i)bdt|tk\.?|taka|৳|,|\s", "", text or "")
    if not t:
        return Decimal("0"), True
    try:
        v = Decimal(t)
    except InvalidOperation:
        raise ValueError(f"“{text.strip()}” isn't an amount. Write the number, e.g. 120000.") from None
    if not v.is_finite() or v < 0 or v >= Decimal("1e12"):
        raise ValueError(f"“{text.strip()}” is out of range.")
    return v.quantize(Decimal("0.01")), False


def parse_kind(text):
    k = text.strip().lower()
    if not k or "amc" in k or "mainten" in k:
        return Contract.Kind.AMC
    if "licen" in k or "subscri" in k or "saas" in k:
        return Contract.Kind.LICENCE
    if "support" in k:
        return Contract.Kind.SUPPORT
    if "soft" in k:
        return Contract.Kind.SOFTWARE
    return Contract.Kind.OTHER


def read(raw):
    """(column index per field, data rows)."""
    if len(raw) > MAX_BYTES:
        raise BadFile("The file is bigger than 2 MB. Split it into smaller files.")
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if not rows:
        raise BadFile("The file is empty.")
    header = [_norm(h) for h in rows[0]]
    cols = {}
    for field, names in FIELDS.items():
        for i, h in enumerate(header):
            if h in names or h == _norm(field):
                cols.setdefault(field, i)
    missing = [LABELS[f] for f in REQUIRED if f not in cols]
    if missing:
        raise BadFile(f"The file needs a column for: {', '.join(missing)}. The first row must hold the column names.")
    if len(rows) - 1 > MAX_ROWS:
        raise BadFile(f"The file has more than {MAX_ROWS} rows. Split it into smaller files.")
    return cols, rows[1:]


def _owners():
    users = list(User.objects.filter(status=User.Status.APPROVED, is_active=True, role__in=[User.Role.ADMIN, User.Role.SUPERVISOR, User.Role.MEMBER]))
    names = {}
    for u in users:
        if u.name:
            names.setdefault(_key(u.name), u)
    return {u.email.lower(): u for u in users}, names


@transaction.atomic
def run(user, raw, dry_run=True):
    cols, body = read(raw)
    by_email, by_name = _owners()
    by_ext = {c.external_id: c for c in Contract.objects.exclude(external_id="")}
    by_match = {(_key(c.client), _key(c.product), c.start_date): c for c in Contract.objects.all()}
    seen, rows, touched = {}, [], []
    created = updated = 0
    for line, row in enumerate(body, start=2):
        def get(field):
            i = cols.get(field)
            return row[i].strip() if i is not None and i < len(row) else ""

        errors, notes = [], []
        client, product = get("client")[:200], get("product")[:120]
        if not client:
            errors.append("Client is empty.")
        if not product:
            errors.append("Product is empty.")
        end = start = None
        try:
            end = parse_date(get("end_date"))
            if end is None:
                errors.append("End date is empty.")
        except ValueError as e:
            errors.append(f"End date: {e}")
        start_ok = True
        try:
            start = parse_date(get("start_date"))
        except ValueError as e:
            errors.append(f"Start date: {e}")
            start_ok = False
        if start is None and end is not None and start_ok:
            start = (end.replace(year=end.year - 1) if not (end.month == 2 and end.day == 29) else end - timedelta(days=365)) + timedelta(days=1)
            notes.append("No start date: taken as one year before the end.")
        if start and end and end < start:
            errors.append("The end date is before the start date.")
        value = Decimal("0")
        try:
            value, empty = parse_money(get("value"))
            if empty and "value" in cols:
                notes.append("No value: imported as 0.")
        except ValueError as e:
            errors.append(f"Value: {e}")
        owner, who = None, get("owner")
        if who:
            owner = by_email.get(who.lower()) or by_name.get(_key(who))
            if owner is None:
                notes.append(f"Nobody called “{who}” has an approved account, so it has no owner yet.")
        ext = get("external_id")[:80]
        key = ("id", ext) if ext else ("match", _key(client), _key(product), start)
        if key in seen:
            errors.append(f"The same contract as row {seen[key]}.")
        target = by_ext.get(ext) if ext else by_match.get((_key(client), _key(product), start))

        out = {"line": line, "client": client, "product": product, "end_date": end, "value": float(value),
               "owner": services.name_of(owner), "errors": errors, "notes": notes}
        if errors:
            rows.append({**out, "action": "error"})
            continue
        seen[key] = line
        data = {"client": client, "product": product, "start_date": start, "end_date": end, "external_id": ext}
        if "kind" in cols:
            data["kind"] = parse_kind(get("kind"))
        if "value" in cols:
            data["value"] = value
        for field, limit in (("terms", 300), ("notes", 2000)):
            if field in cols:
                data[field] = get(field)[:limit]
        if owner is not None:
            data["owner"] = owner
        if target is None:
            created += 1
            if not dry_run:
                touched.append((Contract.objects.create(created_by=user, **data), None))
        else:
            updated += 1
            if not dry_run:
                old_value = target.value
                for k, v in data.items():
                    setattr(target, k, v)
                target.save()
                touched.append((target, old_value))
        rows.append({**out, "action": "create" if target is None else "update"})

    if not dry_run and touched:
        for c, old_value in touched:
            services.after_contract_change(c, old_value)
        audit.log(user, "contract.import", f"{created + updated} contracts", created=created, updated=updated,
                  skipped=sum(1 for r in rows if r["action"] == "error"))
    return {"dry_run": dry_run, "created": created, "updated": updated, "skipped": sum(1 for r in rows if r["action"] == "error"),
            "columns": sorted(cols), "rows": rows}
