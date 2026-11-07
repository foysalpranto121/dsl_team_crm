/** One place for every number and date on screen, so the whole app formats them the same way. */

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions) {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) cache.set(key, (f = new Intl.NumberFormat(locale, opts)));
  return f;
}
const trim = (v: number, digits: number) => nf("en-IN", { maximumFractionDigits: digits }).format(v);

/** 1234.5 → "1,234.5". Empty values show as an em dash. */
export function num(v: number | null | undefined, digits = 1) {
  return v == null || Number.isNaN(v) ? "—" : nf("en-GB", { maximumFractionDigits: digits }).format(v);
}

/** Large counts: 12,900 → "12.9K". */
export function compact(v: number | null | undefined) {
  return v == null ? "—" : nf("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/**
 * Money in Bangladeshi style. Full: "BDT 50,00,000" (lakh grouping). Compact: "BDT 50 L", "BDT 1.25 Cr", "BDT 75K".
 * Pass `currency: null` to leave the currency off.
 */
export function money(v: number | null | undefined, { compact: short = false, currency = "BDT" as string | null } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const body = !short ? trim(v, 0)
    : a >= 1e7 ? `${trim(v / 1e7, 2)} Cr`
    : a >= 1e5 ? `${trim(v / 1e5, 1)} L`
    : a >= 1e3 ? `${trim(v / 1e3, 1)}K`
    : trim(v, 0);
  return currency ? `${currency} ${body}` : body;
}

/** A ratio as a percentage: 0.923 → "92%". */
export function pct(ratio: number | null | undefined, digits = 0) {
  return ratio == null || Number.isNaN(ratio) ? "—" : `${nf("en-GB", { maximumFractionDigits: digits }).format(ratio * 100)}%`;
}

/** A signed change: 12 → "+12", -3.5 → "−3.5", with an optional suffix ("%", " h"). */
export function signed(v: number, digits = 1, suffix = "") {
  const s = nf("en-GB", { maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}${suffix}`;
}

/** "2026-11-07" → a local Date at midnight (no time-zone shift). */
export function isoDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

type DateStyle = "short" | "medium" | "long" | "weekday";
const dateOpts: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { day: "numeric", month: "long", year: "numeric" },
  weekday: { weekday: "long", day: "numeric", month: "long" },
};
/** "2026-11-07" → "7 Nov" / "7 Nov 2026" / "7 November 2026" / "Saturday, 7 November". */
export function date(iso: string | null | undefined, style: DateStyle = "medium") {
  return iso ? isoDate(iso).toLocaleDateString("en-GB", dateOpts[style]) : "—";
}

/** "3 minutes ago", "in 2 days" — for timestamps like audit entries and notifications. */
export function relative(when: string | Date) {
  const t = typeof when === "string" ? new Date(when) : when;
  const s = Math.round((t.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return t.toLocaleDateString("en-GB", dateOpts.medium);
}

/** Seconds → "5h 20m" (or "12m" under an hour). */
export function duration(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
