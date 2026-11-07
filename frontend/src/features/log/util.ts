import type { Pace, Slot, Task } from "@/api/types";
import type { Status } from "@/components/ui/badge";

/** Dates here are team-calendar days as ISO strings ("2026-11-07"), handled in UTC so no time zone can shift them. */

export const SLOTS = 10;

export const utc = (day: string) => new Date(day + "T00:00:00Z");
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** 0 = Sunday … 6 = Saturday, the same numbering the API uses. */
export const dow = (day: string) => utc(day).getUTCDay();
export const weekStartOf = (day: string, startDow: number) => addDays(day, -((dow(day) - startDow + 7) % 7));
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export const monthEnd = (day: string) => { const d = utc(monthStart(day)); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
export const addMonths = (day: string, n: number) => { const d = utc(monthStart(day)); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
export const fmt = (day: string, o: Intl.DateTimeFormatOptions) => utc(day).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
export const range = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

export const fill = (slots: Slot[]) => [...slots, ...Array(SLOTS).fill(null)].slice(0, SLOTS) as Slot[];
export const filled = (slots: Slot[]) => slots.filter((s) => s != null).length;

export const PACE_STATUS: Record<Pace["key"], { status: Status; label: string }> = {
  met: { status: "good", label: "Target met" }, onpace: { status: "good", label: "On pace" }, near: { status: "warning", label: "Near target" },
  behind: { status: "danger", label: "Behind" }, below: { status: "danger", label: "Below target" },
  early: { status: "neutral", label: "Not started" }, none: { status: "neutral", label: "No target" },
};

/** One colour per task type, the same everywhere on the page: the validated categorical palette in fixed order (never
    cycled). A ninth type and later share the neutral colour. */
export function typeColours(tasks: Task[]) {
  const types = [...new Set(tasks.map((t) => t.type || "Other"))];
  return new Map(types.map((t, i) => [t, i < 8 ? `var(--chart-${i + 1})` : "var(--subtle-foreground)"]));
}

export const num = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
export const hoursText = (h: number) => `${num.format(h)} ${h === 1 ? "hour" : "hours"}`;
export const ptsText = (p: number) => `${num.format(p)} ${p === 1 ? "pt" : "pts"}`;

/** A week still running isn't judged yet (as in the workbook): it shows "In progress" until it ends or meets its target.
    A week that hasn't started has no status (null). */
export function weekPace(w: { start: string; end: string; hours: number; target_hours: number; status: Pace }, today: string): { status: Status; label: string } | null {
  if (w.start > today) return null;
  if (w.end >= today && w.hours < w.target_hours) return { status: "info", label: "In progress" };
  return PACE_STATUS[w.status.key];
}
