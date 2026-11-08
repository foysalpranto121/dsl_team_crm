"""My Tasks rules (SRS v0.5 §5.6, D5)."""
import re
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from accounts.models import User
from core import audit
from team import calc
from team import services as team
from team.models import SLOTS, Sheet, SheetEntry, TeamSettings

from .models import PersonalTask

T = PersonalTask
DAYS = {"mon": 0, "monday": 0, "tue": 1, "tues": 1, "tuesday": 1, "wed": 2, "wednesday": 2, "thu": 3, "thur": 3, "thurs": 3, "thursday": 3,
        "fri": 4, "friday": 4, "sat": 5, "saturday": 5, "sun": 6, "sunday": 6}     # Python weekday numbers
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


class TaskError(Exception):
    """The request doesn't make sense as asked (HTTP 400). The message says why."""


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


# ---------- natural dates (FR-MT1) ----------

def parse_when(text, today):
    """today · tomorrow · next week · in 3 days · +3 · Sun · next Sun · 15 Nov · Nov 15 · 15/11 · 2026-11-15."""
    s = " ".join((text or "").lower().replace(",", " ").split())
    try:
        if s in ("", "today", "tod"):
            return today
        if s in ("tomorrow", "tmrw", "tmr", "tom"):
            return today + timedelta(days=1)
        if s == "next week":
            return today + timedelta(days=7)
        if m := re.fullmatch(r"(?:in )?\+?(\d{1,3})(?: ?d| days?)?", s):
            return today + timedelta(days=int(m[1]))
        nxt = s.startswith("next ")
        name = s[5:] if nxt else s
        if name in DAYS:
            ahead = (DAYS[name] - today.weekday()) % 7
            return today + timedelta(days=ahead + (7 if nxt and ahead else 7 if nxt else 0))
        if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s):
            return date(int(m[1]), int(m[2]), int(m[3]))
        found = None
        if m := re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?", s):          # day first, as written in Bangladesh
            found = (int(m[1]), int(m[2]), m[3])
        elif m := re.fullmatch(r"(\d{1,2}) ([a-z]{3})[a-z]*(?: (\d{4}))?", s):
            found = (int(m[1]), MONTHS.get(m[2]), m[3])
        elif m := re.fullmatch(r"([a-z]{3})[a-z]* (\d{1,2})(?: (\d{4}))?", s):
            found = (int(m[2]), MONTHS.get(m[1]), m[3])
        if found and found[1]:
            d, mo, y = found
            year = int(y) + (2000 if y and len(y) == 2 else 0) if y else today.year
            when = date(year, mo, d)
            return when.replace(year=when.year + 1) if not y and when < today else when
    except ValueError:
        pass
    raise TaskError(f"“{text}” isn't a date I know. Try today, tomorrow, Sun, 15 Nov or 2026-11-15.")


# ---------- the person's tasks ----------

def _own(user, task):
    if task.owner_id != user.pk:
        raise NotAllowed("This isn't your task.")


def next_due(task, cfg):
    if task.repeat == T.Repeat.WEEKLY:
        return task.due_date + timedelta(days=7)
    d = task.due_date + timedelta(days=1)
    for _ in range(7):                     # every working day: skip the team's weekend
        if calc.dow(d) not in cfg.weekend_days:
            return d
        d += timedelta(days=1)
    return task.due_date + timedelta(days=1)


def work_sheet(user):
    return Sheet.objects.filter(owner=user, kind=Sheet.Kind.WORK, archived=False).order_by("position", "id").first()


def free_hour(user, day):
    """The first empty hour of the person's work log that day (or None when the day is full or can't be changed)."""
    work = work_sheet(user)
    if work is None or team.entry_block(user, work, day):
        return None
    e = SheetEntry.objects.filter(sheet=work, day=day).first()
    slots = (list(e.slots) if e else []) + [None] * SLOTS
    for i in range(SLOTS):
        if slots[i] is None and not (e and e.meta_at(i).get("status") == "not_done"):
            return i
    return None


@transaction.atomic
def complete(user, task):
    """Done. A repeating task comes back on its next date. Returns (task, next task, the free hour to log it in or None)."""
    _own(user, task)
    if task.status != T.Status.OPEN:
        raise TaskError("This task isn't open.")
    st = TeamSettings.load()
    task.status, task.done_at = T.Status.DONE, timezone.now()
    task.save(update_fields=["status", "done_at", "updated_at"])
    nxt = None
    if task.repeat != T.Repeat.NONE:
        nxt = T.objects.create(owner=task.owner, title=task.title, due_date=next_due(task, team.cfg_of(st)), due_time=task.due_time,
                               priority=task.priority, client=task.client, activity=task.activity, repeat=task.repeat, assigned_by=task.assigned_by)
    if task.assigned_by_id:
        audit.log(user, "task.done", task.title[:200], assigned_by=task.assigned_by.name or task.assigned_by.email)
    return task, nxt, free_hour(user, team.today(st)) if task.activity_id else None


@transaction.atomic
def log_as_hour(user, task, hour):
    """FR-MT5: write the task into an hour of today's work log, as its Activity Type. An assigned task's hour is
    pre-approved; any other follows the normal rules (unplanned hours count provisionally)."""
    _own(user, task)
    if task.activity_id is None:
        raise TaskError("This task has no Activity Type, so it doesn't count as an hour.")
    if task.logged_day:
        raise TaskError("This task is already logged.")
    work = work_sheet(user)
    if work is None:
        raise TaskError("You don't have a daily log yet.")
    today = team.today()
    e = SheetEntry.objects.filter(sheet=work, day=today).first()
    slots = ((list(e.slots) if e else []) + [None] * SLOTS)[:SLOTS]
    if not 0 <= hour < SLOTS or slots[hour] is not None:
        raise TaskError("Choose an empty hour.")
    slots[hour] = task.activity_id
    meta = [(e.meta_at(i) if e else {}) for i in range(SLOTS)]
    meta[hour] = {"status": "done", "task": task.id}
    team.save_entry(user, work, today, slots, e.remarks if e else "", [{k: m.get(k) for k in ("status", "qty", "ref", "reason", "task", "step") if m.get(k) is not None} or None for m in meta])
    task.logged_day, task.logged_hour = today, hour
    task.save(update_fields=["logged_day", "logged_hour", "updated_at"])
    return today, hour


def assigned_review(work, task_id, slot):
    """For team.planning.log_details: an hour logged from a task assigned to this person, as that task's Activity Type,
    is pre-approved (SRS v0.5 FR-MT4/MT5)."""
    t = T.objects.filter(pk=task_id, owner_id=work.owner_id).first() if task_id and work.owner_id else None
    return bool(t and t.assigned_by_id and t.activity_id == slot)


# ---------- supervisors (FR-MT4, FR-MT6) ----------

def assign(user, person_id, title, due, activity=None, priority=T.Priority.NORMAL, due_time=None):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins assign tasks.")
    person = User.objects.filter(pk=person_id, status=User.Status.APPROVED, is_active=True).first()
    if person is None or not person.does_own_work:
        raise TaskError("Choose a member or supervisor to assign it to.")
    if person.pk == user.pk:
        raise TaskError("Add your own tasks in My Tasks; assigning is for other people.")
    t = T.objects.create(owner=person, title=title, due_date=due, due_time=due_time, priority=priority, activity=activity, assigned_by=user)
    audit.log(user, "task.assign", title[:200], person=person.name or person.email, due=str(due))
    return t


def team_summary(user):
    """Per person: open, overdue and done this week (counts only: personal titles stay private), plus the assigned tasks."""
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins see the team's tasks.")
    st = TeamSettings.load()
    today = team.today(st)
    ws = calc.week_start_of(today, team.cfg_of(st))
    people = User.objects.filter(status=User.Status.APPROVED, is_active=True, role__in=[User.Role.MEMBER, User.Role.SUPERVISOR]).order_by("name", "email")
    out = []
    for p in people:
        qs = T.objects.filter(owner=p)
        out.append({"id": p.pk, "name": p.name or p.email, "open": qs.filter(status=T.Status.OPEN).count(),
                    "overdue": qs.filter(status=T.Status.OPEN, due_date__lt=today).count(),
                    "done_week": qs.filter(status=T.Status.DONE, done_at__date__gte=ws).count()})
    assigned = [{"id": t.id, "title": t.title, "person": t.owner.name or t.owner.email, "due_date": t.due_date, "status": t.status,
                 "status_label": t.get_status_display(), "assigned_by": t.assigned_by.name or t.assigned_by.email if t.assigned_by else None,
                 "overdue": t.status == T.Status.OPEN and t.due_date < today, "logged": bool(t.logged_day)}
                for t in T.objects.filter(assigned_by__isnull=False).select_related("owner", "assigned_by").order_by("status", "due_date")[:200]]
    return {"today": today, "people": out, "assigned": assigned}
