"""Pure streak arithmetic (SRS v0.5 FR-MO2, FR-MO3). No database: dates and numbers in, answers out."""
from datetime import timedelta


def day_streaks(closed, first, today, off):
    """(current, best, the first day a run reached each length). Days closed on time in a row. off(day) is a weekend day, holiday or leave: it never breaks a
    streak and doesn't add to one. Today not being closed yet doesn't break it either."""
    best = run = 0
    reached = {}
    d = first
    while d <= today:
        if not off(d):
            if d in closed:
                run += 1
                best = max(best, run)
                reached.setdefault(run, d)
            elif d < today:
                run = 0
        d += timedelta(days=1)
    return run, best, reached


def on_target(w):
    return w["target"] is not None and w["hours"] >= w["target"]


def week_streaks(weeks):
    """(current, best, the first week a run reached each length). weeks: oldest first, [{start, hours, target}]. A week with no target (all leave) is skipped."""
    best = run = 0
    reached = {}
    for w in weeks:
        if w["target"] is None:
            continue
        if on_target(w):
            run += 1
            best = max(best, run)
            reached.setdefault(run, w["start"])
        else:
            run = 0
    return run, best, reached


def comeback(weeks, below=0.8, low_weeks=2):
    """The first week on target straight after at least two weeks under 80% of target (FR-MO3), or None."""
    low = 0
    for w in weeks:
        if w["target"] is None:
            continue
        if on_target(w) and low >= low_weeks:
            return w["start"]
        low = low + 1 if w["hours"] < w["target"] * below else 0
    return None
