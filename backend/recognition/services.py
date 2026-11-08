"""Recognition's rules (SRS v0.5 §5.11, D11, NFR-10). Encouraging by design: there are no low-performer lists, a streak that ends just starts again, and nothing here
touches a score (§7, acceptance test 13). Each part can be switched off per team."""
from collections import defaultdict
from copy import deepcopy
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Min
from django.utils import timezone

from accounts.models import User
from core import audit
from frameworks.services import Calendar
from playbook.models import PlaybookDay
from scoring import services as scoring
from scoring.models import ScoreLedger
from team import calc, planning
from team import services as team
from team.models import Sheet, TeamSettings
from tracker.models import Prospect

from . import calc as rc
from .models import BadgeAward, FeedPost, FeedReaction, LeaveDay

P = FeedPost.Kind
DEFAULTS = {"rings": True, "streaks": True, "badges": True, "wins": True, "reactions": True, "prompts": True, "recap": True, "show_client": True, "show_value": False}
# FR-MO3: five fixed badges. Admin-defined badges are [P2].
BADGES = {
    "first_work_order": ("First Work Order", "Your first verified win."),
    "first_on_target": ("First On-Target Week", "A whole week on your hours target."),
    "on_target_4": ("4-Week On-Target Streak", "Four weeks in a row on your hours target."),
    "comeback": ("Comeback", "Back on target after a couple of quieter weeks."),
    "closer_10": ("10-Day Closer", "Ten working days in a row closed on time."),
}
RECENT = timedelta(days=7)        # older achievements found the first time are awarded quietly: no feed post, no pop-up
NO_RECOGNITION_DAYS = 30


class RecognitionError(Exception):
    """The request doesn't make sense as asked (HTTP 400)."""


class NotAllowed(Exception):
    """This person may not do this (HTTP 403)."""


def config(st=None):
    return {**deepcopy(DEFAULTS), **((st or TeamSettings.load()).recognition or {})}


def clean_config(v):
    if not isinstance(v, dict):
        raise ValueError("The recognition settings must be an object.")
    return {k: bool(v[k]) for k in DEFAULTS if k in v}


def _name(u):
    return (u.name or u.email) if u else ""


# ---------- streaks (FR-MO2) ----------

def _leave(owner_id):
    return set(LeaveDay.objects.filter(owner_id=owner_id).values_list("day", flat=True))


def _off(cal, leave):
    return lambda d: not cal.working(d) or d in leave


def _days(owner_id, t, cal, leave):
    rows = list(PlaybookDay.objects.filter(owner_id=owner_id).values_list("day", "closed_at"))
    if not rows:
        return 0, 0, {}
    return rc.day_streaks({d for d, c in rows if c}, min(d for d, _ in rows), t, _off(cal, leave))


def weeks_of(work, st, t, cal, leave):
    """Each week since the person started, oldest first: output hours and the target, prorated for holidays and leave. This week counts only once it's met,
    so an unfinished week never breaks a streak."""
    cfg = team.cfg_of(st)
    first = work.start_date or ScoreLedger.objects.filter(sheet=work).aggregate(d=Min("day"))["d"]
    if first is None:
        return []
    ws0 = calc.week_start_of(t, cfg)
    ws = max(calc.week_start_of(first, cfg), ws0 - timedelta(weeks=104))
    totals = defaultdict(float)
    for (_, d), n in scoring.day_totals([work.id], ws, ws0 + timedelta(days=6)).items():
        totals[calc.week_start_of(d, cfg)] += n["hours"]
    book, out = scoring.Book(), []
    while ws <= ws0:
        days = [ws + timedelta(days=i) for i in range(7)]
        normal = [d for d in days if calc.dow(d) not in cfg.weekend_days]
        free = [d for d in normal if cal.working(d) and d not in leave]
        target = book.targets(work, ws + timedelta(days=3))["hours"]
        due = calc.r2(target * len(free) / len(normal)) if normal and free and target > 0 else None
        row = {"start": ws, "hours": totals[ws], "target": due}
        if ws < ws0 or rc.on_target(row):
            out.append(row)
        ws += timedelta(days=7)
    return out


# ---------- badges (FR-MO3) ----------

def _first_win(owner_id):
    a = ScoreLedger.objects.filter(sheet__owner_id=owner_id, activity__counts_as_win=True).aggregate(d=Min("day"))["d"]
    b = Prospect.objects.filter(owner_id=owner_id, won_verified_at__isnull=False).aggregate(d=Min("stage_since"))["d"]
    return min((x for x in (a, b) if x), default=None)


def evaluate(owner_id, st=None):
    """Award what's been earned and hasn't been yet. Safe to call any time."""
    st = st or TeamSettings.load()
    conf = config(st)
    if not conf["badges"]:
        return []
    t, cal, leave = team.today(st), Calendar(st), _leave(owner_id)
    have = set(BadgeAward.objects.filter(owner_id=owner_id).values_list("badge", flat=True))
    earned = {}
    if "first_work_order" not in have:
        earned["first_work_order"] = _first_win(owner_id)
    _, _, reached = _days(owner_id, t, cal, leave)
    earned["closer_10"] = reached.get(10)
    work = Sheet.objects.filter(owner_id=owner_id, kind=Sheet.Kind.WORK, archived=False).order_by("position", "id").first()
    if work:
        weeks = weeks_of(work, st, t, cal, leave)
        _, _, w = rc.week_streaks(weeks)
        earned["first_on_target"] = w.get(1)
        earned["on_target_4"] = w.get(4)
        earned["comeback"] = rc.comeback(weeks)
    out = []
    for key, day in earned.items():
        if not day or key in have:
            continue
        old = t - day > RECENT
        a = BadgeAward.objects.create(owner_id=owner_id, badge=key, awarded_on=day, seen_at=timezone.now() if old else None)
        out.append(a)
        if not old:
            FeedPost.objects.create(kind=P.BADGE, owner_id=owner_id, day=day, badge=key, what=BADGES[key][0], seen_at=timezone.now())
    return out


# ---------- My Progress: streaks and badges ----------

def me(user, work_id=None):
    st = TeamSettings.load()
    conf = config(st)
    if work_id:
        work = Sheet.objects.filter(pk=work_id, kind=Sheet.Kind.WORK).select_related("owner").first()
        if work is None:
            raise RecognitionError("That daily log doesn't exist.")
        if work.owner_id != user.pk and not (user.can_approve or user.role == User.Role.VIEWER):
            raise NotAllowed("You see your own; leaders see their team's.")
        owner_id = work.owner_id
    else:
        work, owner_id = planning.work_of_user(user), user.pk
    out = {"config": conf, "streaks": None, "badges": None, "leave": [], "mine": owner_id == user.pk}
    if not owner_id:
        return out
    t, cal, leave = team.today(st), Calendar(st), _leave(owner_id)
    if conf["streaks"]:
        cur, best, _ = _days(owner_id, t, cal, leave)
        wk_cur, wk_best = 0, 0
        if work:
            wk_cur, wk_best, _ = rc.week_streaks(weeks_of(work, st, t, cal, leave))
        out["streaks"] = {"days": {"current": cur, "best": best}, "weeks": {"current": wk_cur, "best": wk_best}}
    if conf["badges"]:
        evaluate(owner_id, st)
        got = {b.badge: b.awarded_on for b in BadgeAward.objects.filter(owner_id=owner_id)}
        out["badges"] = [{"key": k, "name": n, "why": w, "earned_on": got.get(k)} for k, (n, w) in BADGES.items()]
    out["leave"] = list(LeaveDay.objects.filter(owner_id=owner_id, day__gte=t - timedelta(days=14)).values("id", "day", "reason"))
    return out


@transaction.atomic
def add_leave(user, day, reason=""):
    t = team.today()
    if not t - timedelta(days=14) <= day <= t + timedelta(days=120):
        raise RecognitionError("Pick a day within the last two weeks or the next four months.")
    if not Calendar().working(day):
        raise RecognitionError("That's already a day off for the team.")
    row, created = LeaveDay.objects.get_or_create(owner=user, day=day, defaults={"reason": reason.strip()[:120], "by": user})
    if not created:
        raise RecognitionError("You've already marked that day.")
    audit.log(user, "leave.add", str(day), reason=row.reason)
    return row


def remove_leave(user, pk):
    row = LeaveDay.objects.filter(pk=pk, owner=user).first()
    if row is None:
        raise RecognitionError("That day isn't yours.")
    audit.log(user, "leave.remove", str(row.day))
    row.delete()


# ---------- wins (FR-MO4, D11) ----------

def win_verified(user, record=None, event=None, message=""):
    """A supervisor verified a win: it goes on the feed, and the person gets their moment. Verifying twice doesn't post twice."""
    owner_id = record.owner_id if record else event.sheet.owner_id
    if not owner_id:
        return None
    match = {"record": record} if record else {"event": event}
    post = FeedPost.objects.filter(kind=P.WIN, **match).first()
    message = (message or "").strip()[:500]
    if post:
        if message and post.message != message:
            post.message = message
            post.save(update_fields=["message"])
        return post
    return FeedPost.objects.create(kind=P.WIN, owner_id=owner_id, day=(record.stage_since if record else event.day) or team.today(), company=record.company if record else event.evidence[:200], value=record.value if record else None,
                                   what="Won a client" if record else event.activity.name, message=message, by=user if getattr(user, "pk", None) else None, **match)


def win_withdrawn(record=None, event=None):
    """The win no longer stands: the post goes, with its reactions."""
    FeedPost.objects.filter(kind=P.WIN, **({"record": record} if record else {"event": event})).delete()


def _post(p, user, conf, currency, mine_reactions, counts):
    privileged = p.owner_id == user.pk or user.can_approve
    show_client = conf["show_client"] or privileged
    show_value = conf["show_value"] or privileged
    who = _name(p.owner)
    if p.kind == P.WIN:
        title = f"{who} won {p.company}" if show_client and p.company else f"{who} won a new client"
    elif p.kind == P.BADGE:
        title = f"{who} earned {p.what}"
    else:
        title = f"{_name(p.by)} thanked {who}"
    return {"id": p.id, "kind": p.kind, "day": p.day, "title": title, "owner": p.owner_id, "person": who, "company": p.company if show_client else None, "value": float(p.value) if show_value and p.value is not None else None,
            "currency": currency, "message": p.message, "by": _name(p.by) or None, "badge": p.badge or None, "created_at": p.created_at, "mine": p.owner_id == user.pk,
            "reactions": {k: counts.get((p.id, k), 0) for k in FeedReaction.Kind.values}, "reacted": sorted(k for pid, k in mine_reactions if pid == p.id)}


def feed(user, limit=50):
    """FR-MO5: the team's wins, for everyone, management included."""
    st = TeamSettings.load()
    conf = config(st)
    if not conf["wins"]:
        return {"enabled": False, "reactions": conf["reactions"], "posts": []}
    posts = list(FeedPost.objects.select_related("owner", "by").order_by("-day", "-id")[:limit])
    ids = [p.id for p in posts]
    counts = {(r["post_id"], r["kind"]): r["n"] for r in FeedReaction.objects.filter(post_id__in=ids).order_by().values("post_id", "kind").annotate(n=Count("id"))}
    mine = set(FeedReaction.objects.filter(post_id__in=ids, user=user).values_list("post_id", "kind"))
    return {"enabled": True, "reactions": conf["reactions"], "posts": [_post(p, user, conf, st.currency, mine, counts) for p in posts]}


def react(user, pk, kind):
    """Tap to add a reaction, tap again to take it back."""
    if not config()["reactions"]:
        raise RecognitionError("Reactions are switched off.")
    if kind not in FeedReaction.Kind.values:
        raise RecognitionError("Choose a reaction.")
    post = FeedPost.objects.filter(pk=pk).first()
    if post is None:
        raise RecognitionError("That post is gone.")
    row, created = FeedReaction.objects.get_or_create(post=post, user=user, kind=kind)
    if not created:
        row.delete()


def celebrate(user):
    """What this person hasn't seen yet: verified wins get the celebration (§10.4: only those), badges a quiet note."""
    st = TeamSettings.load()
    conf = config(st)
    evaluate(user.pk, st)
    wins = FeedPost.objects.filter(owner=user, kind=P.WIN, seen_at__isnull=True).select_related("by") if conf["wins"] else []
    badges = BadgeAward.objects.filter(owner=user, seen_at__isnull=True) if conf["badges"] else []
    return {"wins": [{"id": p.id, "company": p.company, "value": float(p.value) if p.value is not None else None, "currency": st.currency, "message": p.message, "by": _name(p.by) or None, "what": p.what} for p in wins],
            "badges": [{"id": b.id, "name": BADGES[b.badge][0], "why": BADGES[b.badge][1]} for b in badges if b.badge in BADGES]}


def mark_seen(user, posts=(), badges=()):
    now = timezone.now()
    FeedPost.objects.filter(owner=user, pk__in=list(posts)).update(seen_at=now)
    BadgeAward.objects.filter(owner=user, pk__in=list(badges)).update(seen_at=now)


# ---------- supervisors (FR-MO6) ----------

def thanks(user, work_id, message):
    if not user.can_approve:
        raise NotAllowed("Only supervisors and admins send these.")
    work = Sheet.objects.filter(pk=work_id, kind=Sheet.Kind.WORK).select_related("owner").first()
    if work is None or not work.owner_id:
        raise RecognitionError("That person isn't on the system yet.")
    if work.owner_id == user.pk:
        raise RecognitionError("Thanks are for someone else.")
    message = " ".join((message or "").split())
    if len(message) < 3:
        raise RecognitionError("Write a few words.")
    post = FeedPost.objects.create(kind=P.THANKS, owner_id=work.owner_id, day=team.today(), message=message[:500], by=user, seen_at=timezone.now())
    audit.log(user, "recognition.thanks", _name(work.owner))
    return post


def prompts(user, rows):
    """A nudge to say something: a first on-target week, last week's target met, and anyone with no recognition for 30 days. Never a list of who's behind."""
    st = TeamSettings.load()
    if not (user.can_approve and config(st)["prompts"]):
        return []
    t = team.today(st)
    cfg = team.cfg_of(st)
    last_ws = calc.week_start_of(t, cfg) - timedelta(days=7)
    owners = [r["owner_id"] for r in rows if r["owner_id"] and r["owner_id"] != user.pk]
    firsts = set(BadgeAward.objects.filter(owner_id__in=owners, badge="first_on_target", awarded_on=last_ws).values_list("owner_id", flat=True))
    recent = set(FeedPost.objects.filter(owner_id__in=owners, day__gte=t - timedelta(days=NO_RECOGNITION_DAYS)).values_list("owner_id", flat=True))
    thanked = set(FeedPost.objects.filter(owner_id__in=owners, kind=P.THANKS, day__gte=last_ws, by=user).values_list("owner_id", flat=True))
    out, later = [], []
    for r in rows:
        o = r["owner_id"]
        if not o or o == user.pk or o in thanked:
            continue
        name = r["person"] or r["name"]
        row = {"owner": o, "work": r["id"], "name": name}
        if o in firsts:
            out.append({**row, "text": f"{name} had a first on-target week. Send a word of thanks?"})
        elif r["last_week_status"]["key"] == "met":
            out.append({**row, "text": f"{name} hit last week's hours target. Send a word of thanks?"})
        elif o not in recent:
            later.append({**row, "text": f"{name} hasn't had any recognition for {NO_RECOGNITION_DAYS} days. Anything worth a word?"})
    return (out + later)[:3]
