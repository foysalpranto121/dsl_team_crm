"""Personal tracker rules: stages and their dates, points, the period and its weeks, the daily plan, and the overview numbers.
Ported from the original single-page tracker so the numbers stay the same."""
import csv
import io
from datetime import date, timedelta

from django.db import transaction

from team import services as team_services

from . import template as T
from .models import Activity, PlanDay, Prospect, TrackerSettings

FRIDAY = 4   # Python weekday(): Friday, the weekend day in the plan


def today():
    return team_services.today()


# ---------- settings ----------

def settings_for(user):
    st = TrackerSettings.objects.filter(owner=user).first()
    if st:
        return st
    t = today()
    return TrackerSettings.objects.create(owner=user, period_start=t.replace(day=1), period_days=30,
                                          targets={"points": 0, "leads": 0, "opps": 0, "clients": 0},
                                          weeks=[], rules=dict(T.DEFAULT_RULES), lists={k: list(v) for k, v in T.LISTS.items()})


def rate(st, key):
    v = (st.rules or {}).get(key)
    return float(v) if isinstance(v, (int, float)) else float(T.DEFAULT_RULES.get(key, 0))


def _add_months(d, n):
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def monthly(st):
    """A period that starts on the 1st and lasts about a month repeats every calendar month; any other repeats every period_days."""
    return st.period_start.day == 1 and 28 <= st.period_days <= 31


def period_number(st, day):
    """Which period a day falls in. Periods run back to back from the start date: 0 is the first one set in Settings."""
    if monthly(st):
        return (day.year - st.period_start.year) * 12 + day.month - st.period_start.month
    return (day - st.period_start).days // st.period_days


def period(st, n=None):
    """Start and end of period n; the current one (the period today falls in) when n is None."""
    if n is None:
        n = max(0, period_number(st, today()))
    if monthly(st):
        start = _add_months(st.period_start, n)
        return start, _add_months(start, 1) - timedelta(days=1)
    start = st.period_start + timedelta(days=n * st.period_days)
    return start, start + timedelta(days=st.period_days - 1)


def period_info(st, n=None):
    current = max(0, period_number(st, today()))
    n = current if n is None else n
    start, end = period(st, n)
    t = today()
    days = (end - start).days + 1
    return {"n": n, "current": current, "start": start, "end": end, "days": days,
            "day_index": 0 if t < start else days if t > end else (t - start).days + 1}


def weeks(st, n=None):
    start, end = period(st, n)
    n = max(1, ((end - start).days + 1) // 7)
    out = []
    for i in range(n):
        frm = start + timedelta(days=7 * i)
        to = end if i == n - 1 else frm + timedelta(days=6)
        t = (st.weeks[i] if i < len(st.weeks) and isinstance(st.weeks[i], dict) else {})
        out.append({"n": i + 1, "from": frm, "to": to, "leads": t.get("leads", 0), "opps": t.get("opps", 0), "clients": t.get("clients", 0),
                    "points": t.get("points", 0), "focus": t.get("focus", "")})
    return out


# ---------- prospects ----------

def apply_stage(p, stage, on=None):
    """Moving forward stamps the date a prospect first became a lead, opportunity or client (dates are never wiped)."""
    on = on or today()
    p.stage = stage
    r = T.RANK.get(stage, 0)
    if r >= 2 and not p.lead_date:
        p.lead_date = on
    if r >= 3 and not p.opp_date:
        p.opp_date = on
    if r >= 4 and not p.client_date:
        p.client_date = on
    if r >= 1 and not p.last_contacted:
        p.last_contacted = on


# ---------- numbers ----------

def act_points(st, a):
    return a.qty * rate(st, a.type)


def metrics(st, prospects, activities, frm, to):
    inr = lambda d: d is not None and frm <= d <= to
    L = sum(1 for p in prospects if inr(p.lead_date))
    O = sum(1 for p in prospects if inr(p.opp_date))
    C = sum(1 for p in prospects if inr(p.client_date))
    A = sum(act_points(st, a) for a in activities if frm <= a.date <= to)
    return {"leads": L, "opps": O, "clients": C, "points": round(A + L * rate(st, "m_lead") + O * rate(st, "m_opp") + C * rate(st, "m_client"), 1)}


def day_number(st, day):
    """Day 1, 2, … within the period the day falls in, and that period's number."""
    n = period_number(st, day)
    return (day - period(st, n)[0]).days + 1, n


def default_tasks(st, day):
    if st.plan_template != TrackerSettings.Template.CENTRAL_AI:
        return []
    i, n = day_number(st, day)
    if n < 0:
        return []
    launch = n == 0   # the launch plan's one-off tasks belong to the first period; later periods keep only the daily routine
    special = T.PLAN_DAY.get(i, []) if launch else []
    routine = [] if day.weekday() == FRIDAY or (launch and i < 4) else (T.ROUTINE_CLOSE if i >= 22 else T.ROUTINE)
    return [{"id": f"d{i}-{k}", "text": text, "done": False} for k, text in enumerate(special + routine)]


def plan_days(st, user, frm, to):
    saved = {p.date: p for p in PlanDay.objects.filter(owner=user, date__range=(frm, to))}
    out, d = [], frm
    while d <= to:
        p = saved.get(d)
        out.append({"date": d, "tasks": p.tasks if p else default_tasks(st, d), "note": p.note if p else "", "edited": bool(p),
                    "day": day_number(st, d)[0], "weekend": d.weekday() == FRIDAY})
        d += timedelta(days=1)
    return out


def summary(user, n=None):
    st = settings_for(user)
    t = today()
    info = period_info(st, n)
    start, end = info["start"], info["end"]
    prospects = list(Prospect.objects.filter(owner=user))
    activities = list(Activity.objects.filter(owner=user, date__range=(start, end)))
    plan = plan_days(st, user, start, end)
    plan_stat = lambda a, b: {"done": sum(1 for d in plan if a <= d["date"] <= b for x in d["tasks"] if x.get("done")),
                              "total": sum(len(d["tasks"]) for d in plan if a <= d["date"] <= b)}
    wk = [{**w, "actual": metrics(st, prospects, activities, w["from"], w["to"]), "plan": plan_stat(w["from"], w["to"])} for w in weeks(st, info["n"])]
    contacted = sum(1 for p in prospects if p.stage != "prospect")
    open_ = [p for p in prospects if p.stage not in ("client", "lost")]
    due = sorted((p for p in open_ if p.next_follow_up and p.next_follow_up <= t), key=lambda p: p.next_follow_up)

    def breakdown(field):
        groups = {}
        for p in prospects:
            groups.setdefault(getattr(p, field) or "Not set", []).append(p)
        return [{"key": k, "prospects": len(g), "leads": sum(1 for p in g if p.lead_date), "opps": sum(1 for p in g if p.opp_date),
                 "clients": sum(1 for p in g if p.client_date)} for k, g in sorted(groups.items())]

    return {
        "today": t, "period": info,
        "targets": st.targets, "totals": metrics(st, prospects, activities, start, end), "weeks": wk, "plan": plan_stat(start, end),
        "funnel": {"prospects": len(prospects), "contacted": contacted, "leads": sum(1 for p in prospects if p.lead_date),
                   "opps": sum(1 for p in prospects if p.opp_date), "clients": sum(1 for p in prospects if p.client_date)},
        "due": [{"id": p.id, "company": p.company, "next_follow_up": p.next_follow_up, "next_action": p.next_action, "overdue": p.next_follow_up < t} for p in due[:20]],
        "due_count": len(due), "by_country": breakdown("country"), "by_channel": breakdown("channel"),
        "today_plan": next((d for d in plan if d["date"] == t), None),
    }


# ---------- CSV ----------

COLUMNS = {
    "company": ["company", "company name", "organization", "organisation", "account name", "company name for emails"],
    "website": ["website", "company website", "domain", "url"],
    "contact": ["contact", "name", "full name", "contact name", "person"],
    "first": ["first name", "firstname"], "last": ["last name", "lastname", "surname"],
    "role": ["title", "job title", "position", "role", "designation"],
    "email": ["email", "email address", "work email", "e-mail"],
    "phone": ["phone", "phone number", "mobile", "mobile phone", "work direct phone", "corporate phone", "whatsapp"],
    "linkedin": ["linkedin", "linkedin url", "person linkedin url", "linkedin profile", "profile url"],
    "country": ["country", "company country", "location country"],
    "industry": ["industry", "niche", "sector", "vertical"],
    "channel": ["channel", "source", "source channel"],
    "notes": ["notes", "note", "comments"],
    "stage": ["stage", "status"],
    "next_follow_up": ["next follow-up", "next follow up", "follow-up date"],
}


@transaction.atomic
def import_csv(user, text):
    """Apollo, Hunter, Snov or Sales Navigator exports work directly. Rows repeating a company + email already here are skipped."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ValueError("That CSV has no data rows.")
    head = [h.strip().lower() for h in rows[0]]
    idx = {k: next((i for i, h in enumerate(head) if h in names), None) for k, names in COLUMNS.items()}
    if idx["company"] is None:
        raise ValueError('The CSV needs a "Company" column.')
    seen = {(p.company.lower(), p.email.lower()) for p in Prospect.objects.filter(owner=user)}
    stages = {k: k for k, _ in T.STAGES} | {label.lower(): k for k, label in T.STAGES}
    added, skipped = 0, 0
    for r in rows[1:]:
        g = lambda k: (r[idx[k]].strip() if idx[k] is not None and idx[k] < len(r) else "")
        company, email = g("company"), g("email")
        if not company or (company.lower(), email.lower()) in seen:
            skipped += 1
            continue
        seen.add((company.lower(), email.lower()))
        nxt = g("next_follow_up")
        try:
            nxt = date.fromisoformat(nxt) if nxt else None
        except ValueError:
            nxt = None
        p = Prospect(owner=user, company=company[:200], website=g("website")[:200], contact=(g("contact") or " ".join(x for x in (g("first"), g("last")) if x))[:150],
                     role=g("role")[:150], email=email[:200], phone=g("phone")[:60], linkedin=g("linkedin")[:300], country=(g("country") or "Other")[:80],
                     industry=(g("industry") or "Other")[:80], channel=(g("channel") or "Email")[:60], plan="Not known", notes=g("notes")[:5000], next_follow_up=nxt)
        st = stages.get(g("stage").lower(), "prospect")
        if st != "prospect":
            apply_stage(p, st)
        p.save()
        added += 1
    return {"added": added, "skipped": skipped}


EXPORT_HEAD = ["Company", "Website", "Contact", "Job title", "Email", "Phone", "LinkedIn", "Country", "Industry", "Channel", "Plan", "Stage",
               "Last contacted", "Next follow-up", "Next action", "Lead date", "Opportunity date", "Client date", "Lost reason", "Notes"]
EXPORT_FIELDS = ["company", "website", "contact", "role", "email", "phone", "linkedin", "country", "industry", "channel", "plan", "stage",
                 "last_contacted", "next_follow_up", "next_action", "lead_date", "opp_date", "client_date", "lost_reason", "notes"]


def export_csv(user):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(EXPORT_HEAD)
    labels = dict(T.STAGES)
    for p in Prospect.objects.filter(owner=user).order_by("company"):
        w.writerow([labels.get(p.stage, p.stage) if f == "stage" else (getattr(p, f) or "") for f in EXPORT_FIELDS])
    return "﻿" + out.getvalue()


# ---------- the old single-page tracker's backup file ----------

def _d(v):
    try:
        return date.fromisoformat(v) if v else None
    except (TypeError, ValueError):
        return None


@transaction.atomic
def import_backup(user, data):
    """Bring in a backup (.json) downloaded from the original tracker (app: "central-ai-crm"). Adds to what is here."""
    if not isinstance(data, dict) or data.get("app") != "central-ai-crm":
        raise ValueError("That isn't a backup from the old Central AI tracker.")
    st = settings_for(user)
    cfg = data.get("config") or {}
    if _d(cfg.get("start")):
        st.period_start = _d(cfg["start"])
    if isinstance(cfg.get("days"), int):
        st.period_days = max(7, min(120, cfg["days"]))
    if isinstance(cfg.get("targets"), dict):
        st.targets = {k: cfg["targets"].get(k, 0) for k in ("points", "leads", "opps", "clients")}
    if isinstance(cfg.get("weeks"), list):
        st.weeks = cfg["weeks"]
    if isinstance(cfg.get("rules"), dict) and cfg["rules"]:
        st.rules = {**T.DEFAULT_RULES, **cfg["rules"]}
    st.product, st.tagline = st.product or "Central AI", st.tagline or "International Business Development"
    st.plan_template = TrackerSettings.Template.CENTRAL_AI
    st.save()
    seen = {(p.company.lower(), p.email.lower()) for p in Prospect.objects.filter(owner=user)}
    leads = 0
    for l in data.get("leads") or []:
        if not isinstance(l, dict) or not l.get("company") or (str(l["company"]).lower(), str(l.get("email", "")).lower()) in seen:
            continue
        Prospect.objects.create(owner=user, company=str(l["company"])[:200], website=str(l.get("website", ""))[:200], contact=str(l.get("contact", ""))[:150],
                                role=str(l.get("role", ""))[:150], email=str(l.get("email", ""))[:200], phone=str(l.get("phone", ""))[:60],
                                linkedin=str(l.get("linkedin", ""))[:300], country=str(l.get("country", ""))[:80], industry=str(l.get("niche", ""))[:80],
                                channel=str(l.get("channel", ""))[:60], plan=str(l.get("plan", ""))[:60],
                                stage=l.get("stage") if l.get("stage") in T.RANK else "prospect", last_contacted=_d(l.get("last")),
                                next_follow_up=_d(l.get("next")), next_action=str(l.get("action", ""))[:200], lead_date=_d(l.get("leadDate")),
                                opp_date=_d(l.get("oppDate")), client_date=_d(l.get("clientDate")), lost_reason=str(l.get("lost", ""))[:200],
                                notes=str(l.get("notes", ""))[:5000])
        leads += 1
    acts = 0
    for a in data.get("acts") or []:
        if isinstance(a, dict) and _d(a.get("date")):
            Activity.objects.create(owner=user, date=_d(a["date"]), type=str(a.get("type", "other"))[:20], qty=max(1, int(a.get("qty") or 1)), note=str(a.get("note", ""))[:300])
            acts += 1
    days = 0
    for k, v in (data.get("plan") or {}).items():
        if _d(k) and isinstance(v, dict) and isinstance(v.get("tasks"), list):
            PlanDay.objects.update_or_create(owner=user, date=_d(k), defaults={"tasks": v["tasks"], "note": str(v.get("note", ""))[:2000]})
            days += 1
    return {"prospects": leads, "activities": acts, "plan_days": days}
