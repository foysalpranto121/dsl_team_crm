"""Download the team's data as an Excel workbook laid out like the original Team Operation Sheet.

Every number comes from calc.py (the same rules as the screens), written as values, so the file always agrees with the app.
"""
from datetime import date, timedelta
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from . import calc, services
from .models import SLOTS, JobRole, KpiEntry, Sheet, Task, TeamSettings

BLUE, RED, GREEN, ORANGE, PALE = "034EA1", "EC1C24", "00A550", "FCE4D6", "EEF5FC"
HEAD = PatternFill("solid", fgColor=BLUE)
WEEKEND = PatternFill("solid", fgColor=ORANGE)
TOTAL = PatternFill("solid", fgColor=PALE)
WHITE_BOLD = Font(bold=True, color="FFFFFF")
TITLE = Font(bold=True, size=14, color=BLUE)
THIN = Side(style="thin", color="D5DCE6")
GRID = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _header(ws, row, titles, widths=None):
    for i, t in enumerate(titles, start=1):
        c = ws.cell(row, i, t)
        c.fill, c.font, c.border = HEAD, WHITE_BOLD, GRID
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 30
    for i, w in enumerate(widths or [], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _title(ws, text, sub):
    ws["A1"], ws["A2"] = text, sub
    ws["A1"].font = TITLE
    ws["A2"].font = Font(italic=True, color="5B6880")


def _safe_title(name, used):
    base = "".join(ch for ch in name if ch not in '[]:*?/\\')[:31] or "Sheet"
    title, n = base, 2
    while title.lower() in used:
        title = f"{base[:28]} {n}"
        n += 1
    used.add(title.lower())
    return title


def build_workbook(year, sheet_ids=None):
    st = TeamSettings.load()
    cfg = services.cfg_of(st)
    today = services.today(st)
    tasks = {t.id: t for t in Task.objects.all()}
    pts = {k: float(t.points) for k, t in tasks.items()}
    qs = Sheet.objects.filter(archived=False).select_related("role", "owner")
    if sheet_ids:
        qs = qs.filter(id__in=sheet_ids)
    sheets = list(qs)
    first, last = date(year, 1, 1), date(year, 12, 31)
    wb = Workbook()
    used = {"dashboard", "kpi_weekly_input", "config", "monthly performance"}

    # ---------- Dashboard (first tab) ----------
    dash = wb.active
    dash.title = "Dashboard"
    _title(dash, f"{st.name} — Team Performance {year}", f"Downloaded {today:%d %b %Y} from the DSL Business Team Operation System (TOS). Weeks run Saturday to Friday.")
    _header(dash, 4, ["Sheet", "Person", "Job role", "Hours this year", "Points this year", "Weekly hours target", "Avg hours / completed week",
                      "Monthly points target", "Avg points / completed month"], [18, 24, 28, 14, 14, 14, 16, 14, 16])
    on = min(today, last)
    r = 5
    for s in sheets:
        if s.kind != Sheet.Kind.WORK:
            continue
        days = [calc.Day(e.day, e.slots) for e in s.entries.all()]
        kp = [{"week_start": k.week_start, "leads": k.leads, "opps": k.opps, "clients": k.clients, "revenue": float(k.revenue)} for k in s.kpis.all()]
        d = calc.dashboard(s.targets, days, kp, cfg, pts, on)
        h, p = calc.totals(days, first, last, cfg, pts)
        for c, v in enumerate([s.name, s.person, s.role.name if s.role else "", h, p, float(s.target_hours), d["avg_week_hours"],
                               float(s.target_points), d["avg_month_points"]], start=1):
            dash.cell(r, c, v).border = GRID
        r += 1
    dash.freeze_panes = "A5"

    # ---------- one tab per sheet, like the original ----------
    heads = ["Date", "Day"] + [f"H-{i}" for i in range(1, SLOTS + 1)] + ["Remarks", "Work\nHours", "Earned\nPoints", "Wk#", "Mo#", "Weekly\nHrs Sum", "Monthly\nPts Sum"]
    for s in sheets:
        ws = wb.create_sheet(_safe_title(s.name, used))
        _title(ws, f"{s.person or s.name}  ({s.role.name if s.role else 'no job role'})  —  {'Plan' if s.kind == 'plan' else 'Daily Work Log'} {year}",
               f"Weekly target {float(s.target_hours):g} h · monthly points target {float(s.target_points):g} · counting from {s.start_date or '—'}")
        _header(ws, 4, heads, [11, 6] + [22] * SLOTS + [28, 8, 8, 6, 6, 9, 9])
        entries = {e.day: e for e in s.entries.filter(day__range=(first - timedelta(days=6), last + timedelta(days=6)))}
        days = [calc.Day(d, e.slots) for d, e in entries.items()]
        week_cache, month_cache = {}, {}
        row, d = 5, first
        while d <= last:
            e = entries.get(d)
            slots = (e.slots if e else []) + [None] * SLOTS
            ws0 = calc.week_start_of(d, cfg)
            if ws0 not in week_cache:
                week_cache[ws0] = calc.totals(days, ws0, ws0 + timedelta(days=6), cfg, pts)[0]
            if d.month not in month_cache:
                month_cache[d.month] = calc.totals(days, calc.month_start(d), calc.month_end(d), cfg, pts)[1]
            values = [d, d.strftime("%a")] + [tasks[x].name if x in tasks else None for x in slots[:SLOTS]] + [
                e.remarks if e else None, calc.day_hours(slots) if e else 0, calc.day_points(slots, pts) if e else 0,
                calc.week_no(ws0, cfg)[0], d.month, week_cache[ws0], month_cache[d.month]]
            weekend = calc.dow(d) in cfg.weekend_days
            for c, v in enumerate(values, start=1):
                cell = ws.cell(row, c, v)
                cell.border = GRID
                if weekend:
                    cell.fill = WEEKEND
            ws.cell(row, 1).number_format = "DD-MMM-YY"
            if d == today:
                for c in range(1, len(heads) + 1):
                    ws.cell(row, c).font = Font(bold=True, color=RED)
            row += 1
            d += timedelta(days=1)
        ws.freeze_panes = "C5"

    # ---------- weekly KPI ----------
    kws = wb.create_sheet("KPI_Weekly_Input")
    _title(kws, "Weekly KPI", "One row per person per week (Saturday to Friday). A week counts in the month that holds most of its days.")
    _header(kws, 3, ["Employee\n(Sheet)", "Week Start\n(Saturday)", "Week\n#", "Month\n#", "Qualified\nLeads", "Opportunities", "Clients", "Revenue\n(BDT)", "Notes"],
            [16, 14, 7, 7, 10, 13, 9, 14, 40])
    r = 4
    for k in KpiEntry.objects.filter(sheet__in=[s for s in sheets if s.kind == "work"], week_start__range=(first - timedelta(days=6), last)).select_related("sheet").order_by("week_start", "sheet__position"):
        for c, v in enumerate([k.sheet.name, k.week_start, calc.week_no(k.week_start, cfg)[0], calc.month_of_week(k.week_start)[1],
                               k.leads, k.opps, k.clients, float(k.revenue), k.notes], start=1):
            kws.cell(r, c, v).border = GRID
        kws.cell(r, 2).number_format = "DD-MMM-YY"
        r += 1
    kws.freeze_panes = "A4"

    # ---------- monthly performance ----------
    pws = wb.create_sheet("Monthly Performance")
    _title(pws, f"Monthly Performance {year}", "Composite score = Σ role weight × (actual ÷ own target). Quarter and year = average of completed months.")
    _, rows = services.performance_rows(year, today)
    rows = [x for x in rows if not sheet_ids or x["id"] in sheet_ids]
    r = 4
    for label, key, fmt in (("Composite score", "score", "0%"), ("Avg weekly hours", "avg_weekly", "0.0"), ("Points", "points", "General"),
                            ("Qualified leads", "leads", "0"), ("Opportunities", "opps", "0"), ("Clients", "clients", "0"), ("Revenue (BDT)", "revenue", "#,##0")):
        pws.cell(r, 1, label).font = Font(bold=True, color=BLUE)
        r += 1
        _header(pws, r, ["Person", "Job role"] + MONTHS + ["Q1", "Q2", "Q3", "Q4", str(year)], [24, 26] + [9] * 17)
        r += 1
        for x in rows:
            vals = [x["person"], x["role"] or ""] + [m.get(key) if m["state"] in ("done", "current") else None for m in x["months"]] + \
                   [q.get(key) for q in x["quarters"]] + [x["year"].get(key)]
            for c, v in enumerate(vals, start=1):
                cell = pws.cell(r, c, v)
                cell.border = GRID
                if c > 2:
                    cell.number_format = fmt
                if c > 14:
                    cell.fill = TOTAL
            r += 1
        r += 1

    # ---------- CONFIG ----------
    cws = wb.create_sheet("CONFIG")
    _title(cws, "Configuration", "People and targets, job roles with their weightages, and the task list with points.")
    _header(cws, 3, ["Sheet", "Person", "Job role", "Start date", "Weekly hours", "Monthly points", "Monthly leads", "Monthly opps", "Monthly clients", "Monthly revenue"],
            [18, 24, 28, 12, 12, 12, 12, 12, 12, 14])
    r = 4
    for s in sheets:
        if s.kind == "work":
            for c, v in enumerate([s.name, s.person, s.role.name if s.role else "", s.start_date, float(s.target_hours), float(s.target_points),
                                   float(s.target_leads), float(s.target_opps), float(s.target_clients), float(s.target_revenue)], start=1):
                cws.cell(r, c, v).border = GRID
            cws.cell(r, 4).number_format = "DD-MMM-YY"
            r += 1
    r += 1
    _header(cws, r, ["Job role", "Hours %", "Points %", "Leads %", "Opps %", "Clients %", "Revenue %", "Tasks"])
    r += 1
    for role in JobRole.objects.prefetch_related("tasks"):
        w = role.weights
        for c, v in enumerate([role.name, w["hours"], w["points"], w["leads"], w["opps"], w["clients"], w["revenue"], role.tasks.count()], start=1):
            cws.cell(r, c, v).border = GRID
        r += 1
    r += 1
    _header(cws, r, ["Task type", "Task", "Points", "Active"])
    r += 1
    for t in tasks.values():
        for c, v in enumerate([t.type, t.name, float(t.points), "Yes" if t.active else "No"], start=1):
            cws.cell(r, c, v).border = GRID
        r += 1

    out = BytesIO()
    wb.save(out)
    return out.getvalue()
