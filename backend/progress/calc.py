"""Pure calculations behind My Progress and the AI Coach (SRS v0.5 FR-MO1, FR-AC2, FR-AC3). No database: plain numbers in, plain answers out."""
import math
import re
import statistics

WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten"}
REACHABLE = 5                # past this, "N more gets you to 100%" isn't a useful thing to say
PER_SLOT = re.compile(r"\b(\d{1,3})\s+[\w\s]*calls?\b", re.I)


def plural(n, one, many=None):
    many = many or one + "s"
    shown = f"{n:g}" if isinstance(n, float) else str(n)
    return f"{shown} {one if n == 1 else many}"


def money(v, currency="BDT"):
    """§10.2: lakh and crore, as the team writes them."""
    v = float(v or 0)
    if v >= 1e7:
        return f"{currency} {v / 1e7:.2g} crore" if v < 1e9 else f"{currency} {v / 1e7:,.0f} crore"
    if v >= 1e5:
        return f"{currency} {v / 1e5:.3g} lakh"
    return f"{currency} {v:,.0f}"


def project(actual, elapsed, total, weekly, wd_per_week):
    """FR-AC2: where the month is heading at this pace, with a range from how much this person's weeks vary. None before it has started."""
    if elapsed <= 0 or total <= 0:
        return None
    rate = actual / elapsed
    left = max(0, total - elapsed)
    mid = actual + rate * left
    spread = statistics.pstdev(weekly) if len(weekly) >= 2 else 0.0
    margin = spread * math.sqrt(left / wd_per_week) if wd_per_week else 0.0
    return {"mid": round(mid, 1), "low": round(max(actual, mid - margin), 1), "high": round(mid + margin, 1)}


def to_full_score(score, metrics):
    """FR-MO1: a positive forecast. The fewest more of one KPI that takes a score to 100%; when that's out of reach, what one more of it would add.
    metrics: [{key, label, one, many, weight, target}]. None when none can."""
    if score is None or score >= 1:
        return None
    best = None
    for m in metrics:
        if m["weight"] > 0 and m["target"] > 0:
            each = m["weight"] / 100 / m["target"]
            n = math.ceil((1 - score) / each - 1e-9)
            if n > 0 and (best is None or n < best["units"]):
                best = {"key": m["key"], "units": n, "each": each, "one": m["one"], "many": m["many"]}
    if best is None:
        return None
    n = best["units"]
    if n > REACHABLE:
        return {"key": best["key"], "units": 1, "text": f"One more {best['one']} adds {best['each'] * 100:.3g}% to your score."}
    return {"key": best["key"], "units": n, "text": f"{WORDS.get(n, n)} more {best['one'] if n == 1 else best['many']} {'gets' if n == 1 else 'get'} you to 100%."}


def calls_in(activity_name):
    """"Make 8 Cold Calls" is 8 calls in one slot; other activities aren't counted as calls."""
    m = PER_SLOT.search(activity_name or "")
    return int(m[1]) if m else 0


def catch_up(revenue_gap, avg_deal, client_gap, lead_gap, opp_to_client, lead_to_opp, calls_per_lead):
    """FR-AC2: the target-to-activity calculator: revenue ≈ clients ← opportunities ← leads ← calls, with the rates given. Returns what's needed."""
    clients = math.ceil(revenue_gap / avg_deal) if revenue_gap > 0 and avg_deal else 0
    clients = max(clients, client_gap, 0)
    opps = math.ceil(clients / opp_to_client) if clients and opp_to_client else 0
    leads = max(math.ceil(opps / lead_to_opp) if opps and lead_to_opp else 0, lead_gap, 0)
    calls = math.ceil(leads * calls_per_lead) if leads and calls_per_lead else 0
    return {"clients": clients, "opps": opps, "leads": leads, "calls": calls}


def quality_flags(days):
    """FR-AC3: things worth a second look. days: [{day, slots, remarks, points}], oldest first. Flags never reduce points."""
    out = []
    run, last = [], None
    for d in days:
        sig = (tuple(d["slots"]), d["remarks"].strip().lower())
        if d["slots"] and d["remarks"].strip() and sig == last:
            run.append(d["day"])
        else:
            if len(run) >= 2:
                out.append({"kind": "copied", "day": run[-1], "text": f"The same hours and remarks on {len(run) + 1} days in a row, up to {run[-1].day} {run[-1]:%b}."})
            run = []
        last = sig
    if len(run) >= 2:
        out.append({"kind": "copied", "day": run[-1], "text": f"The same hours and remarks on {len(run) + 1} days in a row, up to {run[-1].day} {run[-1]:%b}."})
    vague = [d for d in days if d["remarks"].strip() and len(d["remarks"].split()) <= 1]
    if len(vague) >= 3:
        out.append({"kind": "vague", "day": vague[-1]["day"], "text": f"One-word remarks on {len(vague)} days. A short sentence helps later."})
    pts = [d["points"] for d in days if d["points"] > 0]
    if len(pts) >= 5:
        usual = statistics.median(pts)
        for d in days:
            if usual > 0 and d["points"] >= max(3 * usual, 10):
                out.append({"kind": "spike", "day": d["day"], "text": f"{d['points']:g} points on {d["day"].day} {d["day"]:%b}, against a usual {usual:g}. Worth checking it's right."})
    return out
