"""Numbers in plain words for the huddle sentences and the digest email (BDT in lakh and crore, like the team says them)."""


def num(v, digits=1):
    if v is None:
        return "—"
    v = round(float(v), digits)
    return f"{v:,.0f}" if v == int(v) else f"{v:,.{digits}f}"


def bdt(v):
    if v is None:
        return "—"
    v = float(v)
    if abs(v) >= 1e7:
        return f"BDT {num(v / 1e7, 2)} crore"
    if abs(v) >= 1e5:
        return f"BDT {num(v / 1e5, 1)} lakh"
    return f"BDT {num(v, 0)}"


def pct(ratio):
    return "—" if ratio is None else f"{float(ratio) * 100:.0f}%"


def days(n):
    return f"{n} day" if n == 1 else f"{n} days"
