"""Team and management tools (SRS v0.3 §14.9).

- Morning huddle (FR-TM1): yesterday's wins and a shout-out, today's plan coverage, what needs attention, and one focus
  for today. Ten minutes, read from data the team already keeps.
- Weekly management digest (FR-TM4): one email a week with scorecards, the funnel, the month's forecast against target,
  the week's wins and the risks.

Every number comes from team.services, the same code as the dashboard. Fairness (NFR-11): the huddle — shown to the whole
team — names people only for good news; the digest goes to admins and management only.
"""
import math
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from accounts.models import User
from accounts.services import photo_of
from core import audit
from core.models import Announcement
from team import calc
from team import services as team
from team.models import KpiEntry, Sheet, SheetEntry, Task, TeamSettings
from tracker.models import Prospect, TrackerSettings
from tracker.template import STAGES

from .format import bdt, days, num
from .models import DigestLog

FOCUS_TITLE = "Today's focus"
STALE_DAYS = 14          # an open deal with no contact for this long counts as stuck
STAGE_LABEL = dict(STAGES)
METRICS = [("points", "Points"), ("leads", "Qualified leads"), ("opps", "Opportunities"), ("clients", "Clients"), ("revenue", "Revenue")]
WIN_FIELDS = ("id", "day", "what", "person", "photo", "details")


class AlreadySent(Exception):
    pass


class NoRecipients(Exception):
    pass


def _person(sheet):
    return sheet.person or (sheet.owner.name if sheet.owner else sheet.name)


def previous_working_day(day, cfg):
    """The last working day before `day` (Saturday's huddle looks back at Thursday when Friday is the weekend)."""
    d = day - timedelta(days=1)
    for _ in range(7):
        if calc.dow(d) not in cfg.weekend_days:
            return d
        d -= timedelta(days=1)
    return day - timedelta(days=1)


def last_full_week(on, cfg):
    return calc.week_start_of(on, cfg) - timedelta(days=7)


def month_totals(rows):
    """The team's month so far, per metric: {key: (actual, target)}."""
    out = {"points": (sum(r["month_points"] for r in rows), sum(r["month_target"] for r in rows))}
    for k in ("leads", "opps", "clients", "revenue"):
        out[k] = (sum(r["kpi_month"][k] for r in rows), sum(r["kpi_targets"][k] for r in rows))
    return out


def focus_suggestion(rows, cfg, on):
    """The month metric furthest behind where the team should be by now, as one plain sentence with a daily number."""
    ms, me = calc.month_start(on), calc.month_end(on)
    total, elapsed, left = calc.working_days(ms, me, cfg), calc.working_days(ms, on, cfg), calc.working_days(on, me, cfg)
    totals, worst = month_totals(rows), None
    for key, label in METRICS:
        actual, target = totals[key]
        if target <= 0 or actual >= target or not elapsed or not total:
            continue
        pace = actual / (target * elapsed / total)
        if pace < 1 and (worst is None or pace < worst[0]):
            worst = (pace, key, label, target - actual)
    if worst is None:
        return {"metric": None, "label": None, "pace": None, "remaining": None, "per_day": None,
                "text": "The team is on pace for every target this month. Keep it going: log every hour and follow up every deal today."}
    pace, key, label, remaining = worst
    per_day = remaining / max(1, left)
    if key == "revenue":
        amount, daily = bdt(remaining), bdt(per_day)
    else:
        unit = " points" if key == "points" else ""
        amount, daily = f"{num(remaining, 0)}{unit}", f"{math.ceil(per_day)}{unit}"
    return {"metric": key, "label": label, "pace": round(pace, 4), "remaining": calc.r2(remaining), "per_day": calc.r2(per_day),
            "text": f"{label}: {amount} to go this month — about {daily} each working day."}


def stuck_deals(on, limit=8):
    """Open deals in pipelines people chose to share with admins: follow-up overdue, or no contact for 14+ days."""
    owners = list(TrackerSettings.objects.filter(share_with_admins=True, owner__status=User.Status.APPROVED, owner__is_active=True)
                  .values_list("owner_id", flat=True))
    items = []
    for p in Prospect.objects.filter(owner_id__in=owners).exclude(stage__in=["client", "lost"]).select_related("owner"):
        last = p.last_contacted or timezone.localdate(p.created_at)
        if p.next_follow_up and p.next_follow_up < on:
            n = (on - p.next_follow_up).days
            reason = f"Follow-up {days(n)} overdue"
        elif (on - last).days >= STALE_DAYS:
            n = (on - last).days
            reason = f"No contact for {days(n)}"
        else:
            continue
        items.append({"id": p.id, "company": p.company, "stage": STAGE_LABEL.get(p.stage, p.stage), "owner": p.owner.name or p.owner.email,
                      "reason": reason, "days": n, "next_action": p.next_action})
    items.sort(key=lambda d: d["days"], reverse=True)
    return {"items": items[:limit], "total": len(items), "shared_pipelines": len(owners)}


# ---------- morning huddle ----------

def huddle(user):
    st = TeamSettings.load()
    cfg, today = team.cfg_of(st), team.today(st)
    prev = previous_working_day(today, cfg)
    ws = calc.week_start_of(today, cfg)
    _, rows = team.dashboard_rows(today)
    pts = {t.id: float(t.points) for t in Task.objects.all()}
    types = dict(Task.objects.values_list("id", "type"))
    work = list(team.work_sheets().select_related("owner__profile"))
    week_wd = calc.working_days(ws, ws + timedelta(days=6), cfg)
    day_target = calc.r2(sum(r["week_target"] for r in rows) / week_wd) if week_wd else 0

    # Yesterday (the last working day): team numbers and the day's top contributor.
    logged = {e.sheet_id: e for e in SheetEntry.objects.filter(sheet__in=work, day=prev)}
    done = [(s, calc.day_hours(logged[s.id].slots), calc.day_points(logged[s.id].slots, pts)) for s in work if s.id in logged]
    star = max(done, key=lambda x: x[2], default=None)
    yesterday = {
        "day": prev, "people": len(work), "logged": sum(1 for _, h, _ in done if h > 0), "target_hours": day_target,
        "hours": calc.r2(sum(h for _, h, _ in done)), "points": calc.r2(sum(p for _, _, p in done)),
        "shout_out": {"person": _person(star[0]), "photo": photo_of(star[0].owner), "hours": star[1], "points": star[2]}
                     if star and star[2] > 0 else None,
    }
    found = team.wins_between(prev, today)
    wins = {"configured": found is not None, "items": [{k: w[k] for k in WIN_FIELDS} for w in (found or [])]}

    # Today's plan: who has planned slots for today on their plan sheet, and what kind of work is planned.
    owners = {s.owner_id for s in work if s.owner_id}
    planned, by_type, hours = set(), {}, 0
    for e in SheetEntry.objects.filter(sheet__kind=Sheet.Kind.PLAN, sheet__archived=False, sheet__owner_id__in=owners, day=today).select_related("sheet"):
        slots = [x for x in e.slots if x]
        if slots:
            planned.add(e.sheet.owner_id)
            hours += len(slots)
            for x in slots:
                kind = types.get(x) or "Other"
                by_type[kind] = by_type.get(kind, 0) + 1
    workday = calc.working_days(today, today, cfg) == 1
    plan = {"people": len(owners), "planned": len(planned), "hours": hours, "target_hours": day_target if workday else 0, "workday": workday,
            "by_type": [{"type": k, "hours": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])]}

    # Needs attention. Names only for admins; everyone else sees their own missing results, as on the dashboard.
    admin = user.is_team_admin
    attention = {
        "missing_results": [{"person": g["person"], "weeks": len(g["weeks"])} for g in team.missing_results(today, None if admin else user.pk)],
        "pending_people": User.objects.filter(status=User.Status.PENDING).count() if admin else None,
        "stuck": stuck_deals(today) if admin else None,
    }

    current = (Announcement.objects.filter(title=FOCUS_TITLE, expires_on=today).select_related("created_by").order_by("-created_at").first())
    focus = {
        "suggested": focus_suggestion(rows, cfg, today),
        "current": {"text": current.body, "by": (current.created_by.name or current.created_by.email) if current.created_by else None,
                    "at": current.created_at} if current else None,
        "can_set": admin,
    }
    return {"team": st.name, "today": today, "week_no": calc.week_no(ws, cfg)[0], "yesterday": yesterday, "wins": wins,
            "plan": plan, "attention": attention, "focus": focus}


def set_focus(user, text):
    """Post the huddle's one focus as today's pinned announcement (it shows on everyone's dashboard until midnight)."""
    today = team.today()
    Announcement.objects.filter(title=FOCUS_TITLE, expires_on=today).delete()
    a = Announcement.objects.create(title=FOCUS_TITLE, body=text, pinned=True, expires_on=today, created_by=user)
    audit.log(user, "huddle.focus", text[:200])
    return a


# ---------- weekly management digest ----------

def digest(week_start):
    st = TeamSettings.load()
    cfg = team.cfg_of(st)
    ws = calc.week_start_of(week_start, cfg)
    we = ws + timedelta(days=6)
    _, rows = team.dashboard_rows(we)
    _, perf = team.performance_rows(we.year, we)
    score = {r["id"]: r["months"][we.month - 1].get("score") for r in perf}
    week_kpi = {k.sheet_id: k for k in KpiEntry.objects.filter(sheet_id__in=[r["id"] for r in rows], week_start=ws)}
    month = month_totals(rows)
    ms, me = calc.month_start(we), calc.month_end(we)
    # The month's totals include every day logged so far (up to today), so the pace counts working days up to the same day.
    as_of = min(team.today(st), me)
    total_wd, elapsed_wd = calc.working_days(ms, me, cfg), calc.working_days(ms, as_of, cfg)

    def forecast(key):
        actual, target = month[key]
        projected = actual / elapsed_wd * total_wd if elapsed_wd else actual
        return {"actual": calc.r2(actual), "target": calc.r2(target), "projected": calc.r2(projected), "ratio": projected / target if target > 0 else None}

    cards = []
    for r in rows:
        k = week_kpi.get(r["id"])
        cards.append({
            "person": r["person"] or r["name"], "role": r["role"], "score": score.get(r["id"]),
            "week_hours": r["week_hours"], "week_target": r["week_target"], "week_status": r["week_status"]["key"],
            "month_points": r["month_points"], "month_target": r["month_target"], "month_status": r["month_status"]["key"],
            "kpi": {"leads": k.leads, "opps": k.opps, "clients": k.clients, "revenue": float(k.revenue)} if k else None,
        })
    cards.sort(key=lambda c: (c["score"] if c["score"] is not None else -1, c["month_points"]), reverse=True)

    risks = []
    for c in cards:
        why = []
        if not c["week_hours"]:
            why.append("no hours logged that week")
        elif c["week_target"] and c["week_status"] in ("behind", "below"):
            why.append(f"{num(c['week_hours'])} of {num(c['week_target'])} hours that week")
        if c["month_target"] and c["month_status"] == "behind":
            why.append(f"points behind pace for the month ({num(c['month_points'])} of {num(c['month_target'])})")
        if c["kpi"] is None or not any(c["kpi"].values()):
            why.append("no weekly results entered")
        if why:
            risks.append({"person": c["person"], "why": why})

    leads, opps, clients = (month[k][0] for k in ("leads", "opps", "clients"))
    return {
        "team": st.name,
        "week": {"start": ws, "end": we, "no": calc.week_no(ws, cfg)[0]},
        "month": {"name": f"{we:%B %Y}", "elapsed_wd": elapsed_wd, "total_wd": total_wd},
        "week_totals": {"hours": calc.r2(sum(c["week_hours"] for c in cards)), "target": calc.r2(sum(c["week_target"] for c in cards)),
                        **{k: calc.r2(sum((c["kpi"] or {}).get(k, 0) for c in cards)) for k in ("leads", "opps", "clients", "revenue")}},
        "month_metrics": [{"key": k, "label": label, "actual": calc.r2(month[k][0]), "target": calc.r2(month[k][1]),
                           "ratio": month[k][0] / month[k][1] if month[k][1] > 0 else None} for k, label in METRICS],
        "forecast": {"points": forecast("points"), "revenue": forecast("revenue")},
        "funnel": {"leads": leads, "opps": opps, "clients": clients,
                   "lead_to_opp": opps / leads if leads else None, "opp_to_client": clients / opps if opps else None},
        "wins": [{k: w[k] for k in WIN_FIELDS} for w in (team.wins_between(ws, we) or [])],
        "scorecards": cards,
        "risks": risks,
        "link": f"{settings.FRONTEND_URL}/dashboard",
    }


def render(data):
    w = data["week"]
    subject = f"{data['team']} · weekly digest · Week {w['no']} ({w['start'].day} {w['start']:%b} – {w['end'].day} {w['end']:%b})"
    return subject, render_to_string("ops/digest_email.txt", data), render_to_string("ops/digest_email.html", data)


def recipients():
    """Admins and management (the read-only viewer role) who are approved and active, plus DIGEST_EXTRA_RECIPIENTS."""
    emails = list(User.objects.filter(status=User.Status.APPROVED, is_active=True, role__in=["admin", "viewer"])
                  .exclude(email="").order_by("email").values_list("email", flat=True))
    for e in settings.DIGEST_EXTRA_RECIPIENTS:
        if e not in emails:
            emails.append(e)
    return emails


def send_digest(week_start, by=None, force=False):
    """Email one week's digest. Each week goes out once unless `force` (an admin chose "Send again")."""
    st = TeamSettings.load()
    ws = calc.week_start_of(week_start, team.cfg_of(st))
    if not force and DigestLog.objects.filter(week_start=ws).exists():
        raise AlreadySent(ws)
    to = recipients()
    if not to:
        raise NoRecipients("No admin or management account has an email address.")
    data = digest(ws)
    subject, text, html = render(data)
    msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, to)
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)
    log, _ = DigestLog.objects.update_or_create(week_start=ws, defaults={"sent_at": timezone.now(), "recipients": to, "sent_by": by})
    audit.log(by, "digest.send", f"Week {data['week']['no']}", recipients=len(to), automatic=by is None)
    return log


def run_scheduled(on=None):
    """What the weekly schedule calls: send last week's digest unless it already went out. Returns (log or None, week start)."""
    st = TeamSettings.load()
    ws = last_full_week(on or team.today(st), team.cfg_of(st))
    if DigestLog.objects.filter(week_start=ws).exists():
        return None, ws
    return send_digest(ws), ws
