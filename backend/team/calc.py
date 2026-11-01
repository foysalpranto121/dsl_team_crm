"""Team sheet calculations: hours, points, weeks, months, dashboard and performance scores.

Plain functions on plain data (no database), checked against the values Excel saved in the
DSL Team Operation Sheet. Day-of-week numbers follow that sheet: 0 = Sunday … 6 = Saturday.
"""
import calendar
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_tz
from zoneinfo import ZoneInfo

METRICS = ("hours", "points", "leads", "opps", "clients", "revenue")
KPI_KEYS = ("leads", "opps", "clients", "revenue")


@dataclass
class Cfg:
    week_start_dow: int = 6           # Saturday
    weekend_days: frozenset = field(default_factory=lambda: frozenset({5}))  # Friday
    count_weekend: bool = True


@dataclass
class Day:
    day: date
    slots: list


def r2(x):
    return round(x + 0.0, 2)


# ---------- dates ----------

def dow(d):
    return (d.weekday() + 1) % 7      # Python: Monday = 0 → Sunday = 0


def today_in(tz, now=None):
    now = now or datetime.now(dt_tz.utc)
    return now.astimezone(ZoneInfo(tz)).date()


def seconds_to_midnight(tz, now=None):
    local = (now or datetime.now(dt_tz.utc)).astimezone(ZoneInfo(tz))
    nxt = datetime.combine(local.date() + timedelta(days=1), time(), tzinfo=local.tzinfo)
    return max(0, int((nxt - local).total_seconds()))


def month_start(d):
    return d.replace(day=1)


def month_end(d):
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def days_in_month(d):
    return calendar.monthrange(d.year, d.month)[1]


def add_months(d, n):
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def week_start_of(d, cfg):
    return d - timedelta(days=(dow(d) - cfg.week_start_dow) % 7)


def week_no(ws, cfg):
    """Weeks counted from the one that holds 1 January; a week crossing New Year is week 1 of the new year."""
    last = ws + timedelta(days=6)
    first = week_start_of(date(last.year, 1, 1), cfg)
    return (last - first).days // 7 + 1, last.year


def month_of_week(ws):
    """A week's results count in the month that holds most of its days (its 4th day)."""
    d = ws + timedelta(days=3)
    return d.year, d.month


def month_for_number(ws, m):
    """The YYYY-MM a workbook's month number means for the week starting ws: the year nearest the week's start."""
    y = min((ws.year - 1, ws.year, ws.year + 1), key=lambda y: abs((y * 12 + m) - (ws.year * 12 + ws.month)))
    return f"{y}-{m:02d}"


def counted_month(k):
    """(year, month) a week's results count in: the month the workbook gave, else the month holding most of its days."""
    if k.get("counts_in"):
        y, m = k["counts_in"].split("-")
        return int(y), int(m)
    return month_of_week(k["week_start"])


def working_days(a, b, cfg):
    n, d = 0, a
    while d <= b:
        if dow(d) not in cfg.weekend_days:
            n += 1
        d += timedelta(days=1)
    return n


def months_between(a, b):
    """Months between two dates as a fraction, e.g. 15 Oct – 30 Nov = 17/31 + 1."""
    m, ms = 0.0, month_start(a)
    while ms <= b:
        m += ((min(b, month_end(ms)) - max(a, ms)).days + 1) / days_in_month(ms)
        ms = add_months(ms, 1)
    return m


# ---------- days ----------

def filled(slots):
    return [s for s in (slots or []) if s not in (None, "")]


def day_hours(slots):
    return len(filled(slots))             # each filled slot is one hour


def day_points(slots, pts):
    return r2(sum(pts.get(s, 0.0) for s in filled(slots)))


def counts(d, cfg):
    return cfg.count_weekend or dow(d) not in cfg.weekend_days


def totals(entries, a, b, cfg, pts):
    hours, points = 0, 0.0
    for e in entries:
        if a <= e.day <= b and counts(e.day, cfg):
            hours += day_hours(e.slots)
            points += day_points(e.slots, pts)
    return hours, r2(points)


def kpi_for(kpis, test):
    o = {"leads": 0, "opps": 0, "clients": 0, "revenue": 0.0, "weeks": 0}
    for k in kpis:
        if test(k):
            for x in KPI_KEYS:
                o[x] += float(k[x]) if x == "revenue" else int(k[x])
            o["weeks"] += 1
    o["revenue"] = r2(o["revenue"])
    return o


# ---------- status ----------

def pace_of(actual, target, elapsed_wd, total_wd):
    """While a period runs, compare with where you should be by now (working days so far)."""
    if not target > 0:
        return {"key": "none", "pct": None}
    pct = actual / target
    if actual >= target:
        return {"key": "met", "pct": pct}
    if elapsed_wd <= 0 or total_wd <= 0:
        return {"key": "early", "pct": pct}
    expected = target * elapsed_wd / total_wd
    r = actual / expected
    return {"key": "onpace" if r >= 1 else "near" if r >= 0.8 else "behind", "pct": pct, "expected": r2(expected)}


def final_of(actual, target):
    """When a period is over: met (100%+), near (80%+) or below."""
    if not target > 0:
        return {"key": "none", "pct": None}
    pct = actual / target
    return {"key": "met" if pct >= 1 else "near" if pct >= 0.8 else "below", "pct": pct}


def start_of(targets, entries, fallback):
    if targets.get("start"):
        return targets["start"]
    days = [e.day for e in entries if day_hours(e.slots)]
    return min(days) if days else fallback


# ---------- dashboard ----------

def last_full_week_end(day, cfg):
    """The last day of the last whole week that ends on or before `day`."""
    we = week_start_of(day, cfg) + timedelta(days=6)
    return we if we <= day else we - timedelta(days=7)


def dashboard(targets, entries, kpis, cfg, pts, today, week_on=None):
    """week_on picks the week shown (default: the week of `today`); a finished month uses its last whole week."""
    T = targets
    start = start_of(T, entries, today)
    ws0 = week_start_of(week_on or today, cfg)
    we0 = ws0 + timedelta(days=6)
    week_h, _ = totals(entries, ws0, we0, cfg, pts)
    last_h, _ = totals(entries, ws0 - timedelta(days=7), ws0 - timedelta(days=1), cfg, pts)
    w_to = ws0 - timedelta(days=1)                                   # averages use completed weeks only
    avg_week = r2(totals(entries, start, w_to, cfg, pts)[0] / (((w_to - start).days + 1) / 7)) if start <= w_to else None
    ms0, me0 = month_start(today), month_end(today)
    lms = add_months(ms0, -1)
    _, month_p = totals(entries, ms0, me0, cfg, pts)
    _, last_p = totals(entries, lms, month_end(lms), cfg, pts)
    m_to = ms0 - timedelta(days=1)                                   # and completed months only
    avg_month = r2(totals(entries, start, m_to, cfg, pts)[1] / months_between(start, m_to)) if start <= m_to else None
    ytd_h, ytd_p = totals(entries, date(today.year, 1, 1), today, cfg, pts)
    key = (today.year, today.month)
    today_entry = next((e for e in entries if e.day == today), None)
    return {
        "start": start, "week_start": ws0, "week_end": we0,
        "week_hours": week_h, "last_week_hours": last_h, "avg_week_hours": avg_week, "week_target": T["hours"],
        "week_status": pace_of(week_h, T["hours"], working_days(ws0, min(today, we0), cfg), working_days(ws0, we0, cfg)),
        "last_week_status": final_of(last_h, T["hours"]),
        "month_points": month_p, "last_month_points": last_p, "avg_month_points": avg_month, "month_target": T["points"],
        "month_status": pace_of(month_p, T["points"], working_days(ms0, today, cfg), working_days(ms0, me0, cfg)),
        "last_month_status": final_of(last_p, T["points"]),
        "ytd_hours": ytd_h, "ytd_points": ytd_p, "today_hours": day_hours(today_entry.slots) if today_entry else 0,
        "kpi_month": kpi_for(kpis, lambda k: counted_month(k) == key),
        "kpi_targets": {k: T[k] for k in KPI_KEYS},
    }


# ---------- composite score ----------

def performance(targets, entries, kpis, cfg, pts, weights, year, today):
    """score = Σ weight × (actual ÷ target) over the six metrics, with the person's own targets and job role weights.
    Hours compare average hours per week with the weekly target. The start month is pro-rated.
    A metric with no target adds nothing. Quarter and year scores average the completed months."""
    T, W = targets, weights or {m: 0.0 for m in METRICS}
    start = start_of(T, entries, date(year, 1, 1))
    months = []
    for m in range(1, 13):
        ms = date(year, m, 1)
        me, dim = month_end(ms), days_in_month(ms)
        if ms > today:
            months.append({"m": m, "state": "future"})
            continue
        k = kpi_for(kpis, lambda x, key=(year, m): counted_month(x) == key)
        if start > me:
            h, p = totals(entries, ms, me, cfg, pts)
            months.append({"m": m, "state": "before", "hours": h, "points": p, **k})
            continue
        frm = max(ms, start)
        covered = (me - frm).days + 1
        frac = covered / dim
        h, p = totals(entries, frm, me, cfg, pts)
        actual = {"hours": h / (covered / 7), "points": p, **{x: k[x] for x in KPI_KEYS}}   # exact; rounded only for display
        target = {"hours": T["hours"], **{x: T[x] * frac for x in ("points",) + KPI_KEYS}}
        ratio = {x: (actual[x] / target[x] if target[x] > 0 else 0.0) for x in METRICS}
        score = sum(W[x] / 100 * ratio[x] for x in METRICS)
        months.append({"m": m, "state": "current" if today <= me else "done", "from": frm, "hours": h, "avg_weekly": r2(actual["hours"]),
                       "points": p, **{x: k[x] for x in KPI_KEYS}, "target": target, "ratio": ratio, "score": score})

    def roll(lst):
        scored = [x for x in lst if x["state"] in ("done", "current")]
        done = [x for x in lst if x["state"] == "done"]
        covered = sum((month_end(x["from"]) - x["from"]).days + 1 for x in scored)
        hours = sum(x["hours"] for x in scored)
        return {"hours": hours, "avg_weekly": r2(hours / (covered / 7)) if covered else None,
                **{x: r2(sum(y[x] for y in scored)) for x in ("points",) + KPI_KEYS},
                "score": sum(x["score"] for x in done) / len(done) if done else None, "months": len(done)}

    return {"start": start, "weights": W, "months": months, "quarters": [roll(months[q * 3:q * 3 + 3]) for q in range(4)], "year": roll(months)}


def warnings(roles, sheets):
    """Setup problems shown to admins. roles: [{name, weights, tasks}], sheets: [{name, kind, archived, role (name or None), targets}]"""
    out = []
    by_name = {r["name"]: r for r in roles}
    for r in roles:
        total = sum(r["weights"].values())
        if abs(total - 100) > 0.01:
            out.append(f'Job role "{r["name"]}": weightages add up to {r2(total)}%, not 100%.')
        if not r["tasks"]:
            out.append(f'Job role "{r["name"]}" has no tasks, so its dropdowns will be empty.')
    for s in sheets:
        if s["kind"] != "work" or s["archived"]:
            continue
        r = by_name.get(s["role"])
        if not r:
            out.append(f'Sheet "{s["name"]}" has no job role, so it has no tasks to choose from and no score.')
            continue
        missing = [m for m in METRICS if r["weights"][m] > 0 and not s["targets"][m] > 0]
        if missing:
            out.append(f'Sheet "{s["name"]}": {r["name"]} gives weight to {", ".join(missing)} but the sheet has no target for '
                       f'{"them" if len(missing) > 1 else "it"}, so that part of the score is always 0.')
    return out
