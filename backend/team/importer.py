"""Import the DSL "Team Operation Sheet" workbook (.xlsx) into the team tables.

Reads the same layout people already use: CONFIG (people, targets, tasks, job roles, weightages), one tab per person
(date, H-1…H-10, remarks), "Planning - <name>" tabs, and KPI_Weekly_Input. Running it again updates what is there
instead of making copies. With dry_run=True everything is checked and counted, then rolled back.
"""
import re
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

from accounts.models import User
from core import audit

from . import calc
from .models import METRICS, JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings

FIRST_ROW = 5          # first day row on a person tab
TASK_ROW = 21          # first task row in CONFIG
ROLE_COLS = range(8, 12)   # CONFIG H..K: one task list per job role
WEIGHT_ROWS = dict(zip(METRICS, range(11, 17)))   # CONFIG rows 11-16, columns B..E


class WorkbookError(Exception):
    pass


def _text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def _num(v, default=Decimal(0)):
    try:
        return Decimal(str(v)) if v not in (None, "") else default
    except (InvalidOperation, ValueError):
        return default


def _day(v):
    if isinstance(v, datetime):
        return v.date()
    return v if isinstance(v, date) else None


def _role_title(header):
    """'🟦 National Sales (Tender)\n(Edit to change dropdown)' -> 'National Sales (Tender)'"""
    first = str(header or "").split("\n")[0]
    return re.sub(r"^[^\w(]+", "", first).strip()


def import_workbook(fileobj, actor, dry_run=False):
    try:
        wb = load_workbook(fileobj, data_only=True)
    except Exception as e:
        raise WorkbookError("This file couldn't be opened as an Excel workbook (.xlsx).") from e
    if "CONFIG" not in wb.sheetnames:
        raise WorkbookError("This doesn't look like the Team Operation Sheet: there is no CONFIG tab.")
    cfg = wb["CONFIG"]
    report = {"dry_run": dry_run, "tasks": {"created": [], "updated": []}, "roles": [], "sheets": [], "kpi": {"weeks": 0, "month_differs": 0},
              "warnings": []}
    warn = report["warnings"].append

    with transaction.atomic():
        st = TeamSettings.load()
        cal = calc.Cfg(week_start_dow=st.week_start_dow, weekend_days=frozenset(st.weekend_days), count_weekend=st.count_weekend)

        # ---- tasks (CONFIG A, C, D) ----
        tasks = {t.name.lower(): t for t in Task.objects.all()}
        position = max([t.position for t in tasks.values()] + [0])
        r, blanks = TASK_ROW, 0
        while blanks < 5 and r < TASK_ROW + 300:
            name, typ, pts = _text(cfg.cell(r, 3).value), _text(cfg.cell(r, 1).value), cfg.cell(r, 4).value
            r += 1
            if not name:
                blanks += 1
                continue
            blanks = 0
            t = tasks.get(name.lower())
            if t is None:
                position += 1
                t = tasks[name.lower()] = Task.objects.create(name=name, type=typ, points=_num(pts, Decimal(1)), position=position)
                report["tasks"]["created"].append(name)
            elif (t.type, t.points) != (typ or t.type, _num(pts, t.points)):
                t.type, t.points = typ or t.type, _num(pts, t.points)
                t.save(update_fields=["type", "points"])
                report["tasks"]["updated"].append(name)

        # ---- job roles (CONFIG H..K task lists, B..E weightages in the same order) ----
        roles_by_col = {}
        for i, col in enumerate(ROLE_COLS):
            title = _role_title(cfg.cell(TASK_ROW - 1, col).value)
            if not title:
                continue
            role, _ = JobRole.objects.get_or_create(name=title)
            labels = [_text(cfg.cell(rr, col).value) for rr in range(TASK_ROW, TASK_ROW + 300)]
            ids = [tasks[x.lower()].id for x in labels if x and x.lower() in tasks]
            missing = [x for x in labels if x and x.lower() not in tasks]
            if missing:
                warn(f'Job role "{title}": {len(missing)} dropdown item(s) aren\'t in the task list and were left out: {", ".join(missing[:5])}')
            role.tasks.set(ids)
            for m, row in WEIGHT_ROWS.items():
                w = _num(cfg.cell(row, 2 + i).value)
                setattr(role, "w_" + m, (w * 100 if w <= 1 else w).quantize(Decimal("0.01")))
            role.save()
            roles_by_col[col] = role
            report["roles"].append({"name": title, "tasks": len(ids), "weights": sum(role.weights.values())})

        def role_for(ws, fallback_text):
            for dv in ws.data_validations.dataValidation:     # the tab's dropdown points at its role's column
                m = re.search(r"CONFIG!\$?([A-Z]+)\$?\d+", str(dv.formula1 or ""))
                if m and column_index_from_string(m.group(1)) in roles_by_col:
                    return roles_by_col[column_index_from_string(m.group(1))]
            low = fallback_text.lower()
            return next((r for r in roles_by_col.values() if r.name.lower() in low or low in r.name.lower()), None)

        # ---- people (CONFIG row 4 onwards) and their tabs ----
        people_years = {}
        r = 4
        while _text(cfg.cell(r, 1).value):
            short, full, role_text = _text(cfg.cell(r, 1).value), _text(cfg.cell(r, 2).value), _text(cfg.cell(r, 3).value)
            start = _day(cfg.cell(r, 4).value)
            targets = {"target_hours": _num(cfg.cell(r, 5).value), "target_points": _num(cfg.cell(r, 6).value),
                       "target_leads": _num(cfg.cell(r, 7).value), "target_opps": _num(cfg.cell(r, 8).value),
                       "target_clients": _num(cfg.cell(r, 9).value), "target_revenue": _num(cfg.cell(r, 10).value)}
            r += 1
            owners = list(User.objects.filter(name__iexact=full, status=User.Status.APPROVED).exclude(role=User.Role.VIEWER)) if full else []
            owner = owners[0] if len(owners) == 1 else None
            for tab, kind in ((short, Sheet.Kind.WORK), (f"Planning - {short}", Sheet.Kind.PLAN)):
                if tab not in wb.sheetnames:
                    if kind == Sheet.Kind.WORK:
                        warn(f'"{short}" is listed in CONFIG but there is no "{short}" tab, so no days were imported for them.')
                    continue
                ws = wb[tab]
                role = role_for(ws, role_text)
                sheet = Sheet.objects.filter(name__iexact=tab).first() or Sheet(name=tab)
                created = sheet.pk is None
                sheet.kind, sheet.person, sheet.role = kind, full or short, role or sheet.role
                if sheet.owner_id is None and owner:
                    sheet.owner = owner
                if kind == Sheet.Kind.WORK:
                    for k, v in targets.items():
                        setattr(sheet, k, v)
                    sheet.start_date = start or sheet.start_date
                sheet.save()
                existing = {e.day: e for e in sheet.entries.all()}
                n_days, leave_only, unknown, years = 0, 0, Counter(), Counter()
                for row in ws.iter_rows(min_row=FIRST_ROW, max_col=13, values_only=True):
                    day = _day(row[0])
                    if not day:
                        continue
                    labels = [_text(v) for v in row[2:12]]
                    remarks = _text(row[12]) if len(row) > 12 else ""
                    slots = []
                    for lab in labels:
                        if not lab:
                            slots.append(None)
                            continue
                        t = tasks.get(lab.lower())
                        if t is None:          # keep the hour: add it as a switched-off task with 0 points
                            position += 1
                            t = tasks[lab.lower()] = Task.objects.create(name=lab, type="Imported", points=0, active=False, position=position)
                            report["tasks"]["created"].append(lab)
                        unknown[lab] += t.type == "Imported"
                        slots.append(t.id)
                    while slots and slots[-1] is None:
                        slots.pop()
                    if not slots and not remarks:
                        continue
                    if not calc.filled(slots):
                        leave_only += 1
                    e = existing.get(day) or SheetEntry(sheet=sheet, day=day)
                    e.slots, e.remarks, e.updated_by = slots, remarks[:2000], actor
                    e.save()
                    n_days += 1
                    years[day.year] += 1
                days = [calc.Day(e.day, e.slots) for e in sheet.entries.all()]
                pts = {t.id: float(t.points) for t in tasks.values()}
                h, p = calc.totals(days, date.min, date.max, cal, pts)
                report["sheets"].append({"name": tab, "kind": kind, "person": sheet.person, "role": role.name if role else None,
                                         "owner": sheet.owner.email if sheet.owner else None, "created": created, "days": n_days,
                                         "hours": h, "points": p, "leave_only_days": leave_only})
                if not role:
                    warn(f'Couldn\'t tell which job role "{tab}" uses; pick one in Team setup.')
                if [k for k, v in unknown.items() if v]:
                    warn(f'"{tab}": tasks not in the CONFIG list were added as switched-off tasks with 0 points: {", ".join(sorted(k for k, v in unknown.items() if v)[:5])}')
                if kind == Sheet.Kind.WORK and years:
                    people_years[short.lower()] = years.most_common(1)[0][0]

        # ---- weekly KPI (KPI_Weekly_Input: A name, C week no, D month no, E..H values, I notes) ----
        if "KPI_Weekly_Input" in wb.sheetnames:
            sheets = {s.name.lower(): s for s in Sheet.objects.filter(kind=Sheet.Kind.WORK)}
            default_year = Counter(people_years.values()).most_common(1)[0][0] if people_years else calc.today_in(st.timezone).year
            for row in wb["KPI_Weekly_Input"].iter_rows(min_row=4, max_col=9, values_only=True):
                name, wk = _text(row[0]), row[2]
                values, notes = row[4:8], _text(row[8])
                if not name or not isinstance(wk, (int, float)) or (all(v in (None, "") for v in values) and not notes):
                    continue
                sheet = sheets.get(name.lower())
                if not sheet:
                    warn(f'Weekly KPI row for "{name}" skipped: there is no sheet with that name.')
                    continue
                year = people_years.get(name.lower(), default_year)
                ws0 = calc.week_start_of(date(year, 1, 1), cal) + timedelta(days=7 * (int(wk) - 1))
                k, _ = KpiEntry.objects.get_or_create(sheet=sheet, week_start=ws0)
                k.leads, k.opps, k.clients = (int(_num(v)) for v in values[:3])
                k.revenue, k.notes, k.updated_by = _num(values[3]), notes[:2000], actor
                k.save()
                report["kpi"]["weeks"] += 1
                if isinstance(row[3], (int, float)) and calc.month_of_week(ws0)[1] != int(row[3]):
                    report["kpi"]["month_differs"] += 1

        if report["kpi"]["month_differs"]:
            warn(f'{report["kpi"]["month_differs"]} weekly KPI row(s) had a month number that differs from the month holding most of that week; '
                 "the system counts each week in the month that holds most of its days.")
        leave = sum(s["leave_only_days"] for s in report["sheets"])
        if leave:
            warn(f"{leave} day(s) have only a remark (leave, holiday) and no tasks. They are kept but count 0 hours; "
                 "some rows in the workbook counted the remark as 1 hour.")
        if dry_run:
            transaction.set_rollback(True)
        else:
            audit.log(actor, "import.workbook", "Team Operation Sheet", sheets=len(report["sheets"]), kpi_weeks=report["kpi"]["weeks"])
    return report
