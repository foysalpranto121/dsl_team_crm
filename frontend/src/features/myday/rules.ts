import type { HourMeta, Slot } from "@/api/types";
import { SLOTS } from "../log/util";

/**
 * The hour-log rules of SRS v0.5 §6, mirrored from the server (team/planning.py) so the screen shows what each hour will
 * count as before it is saved. The server stays the judge.
 */

export type Hour = { task: Slot; meta: HourMeta };
export type Kind = "planned" | "as_planned" | "not_done" | "deviation" | "unplanned" | "empty";

export const pad = <T,>(xs: T[] | undefined, fill: T): T[] => [...(xs ?? []), ...Array(SLOTS).fill(fill)].slice(0, SLOTS);

export function kindOf(planned: Slot, h: Hour): Kind {
  if (h.meta.status === "not_done") return "not_done";
  if (h.task == null) return planned != null ? "planned" : "empty";
  if (planned == null) return "unplanned";
  return h.task === planned ? "as_planned" : "deviation";
}

/** The review an hour will have after saving (previous: the hour as the server has it now). */
export function reviewOf(planned: Slot, h: Hour, previous: Hour | undefined, strict: boolean): HourMeta["review"] {
  const k = kindOf(planned, h);
  const same = previous && previous.task === h.task && previous.task != null;
  if (k === "deviation") return same && (previous!.meta.review === "approved" || previous!.meta.review === "rejected") ? previous!.meta.review : "pending";
  if (k === "unplanned") return same ? previous!.meta.review : strict ? "pending" : undefined;
  if (k === "as_planned" && same && previous!.meta.review === "flagged") return "flagged";
  return undefined;
}

export const counts = (h: Hour, review: HourMeta["review"]) =>
  h.task != null && h.meta.status !== "not_done" && review !== "pending" && review !== "rejected" && review !== "flagged";

/** A missing reason that would stop the save, as a sentence, or null. */
export function missingReason(planned: Slot[], hours: Hour[]): string | null {
  for (let i = 0; i < SLOTS; i++) {
    const k = kindOf(planned[i], hours[i]);
    if ((k === "deviation" || k === "not_done") && !hours[i].meta.reason?.trim()) {
      return k === "deviation" ? `Hour ${i + 1}: say why you did something other than the plan.` : `Hour ${i + 1}: say why the planned task wasn't done.`;
    }
  }
  return null;
}

/** FR-T6: the day's planned (approved), logged and output hours, points and adherence. */
export function summary(planned: Slot[], hours: Hour[], reviews: HourMeta["review"][], points: (task: number) => number) {
  let approved = 0, logged = 0, output = 0, pts = 0, done = 0;
  hours.forEach((h, i) => {
    if (planned[i] != null) approved++;
    if (h.task != null) logged++;
    if (counts(h, reviews[i])) {
      output++;
      pts += points(h.task!);
      if (planned[i] != null && h.task === planned[i]) done += h.meta.status === "partly" ? 0.5 : 1;
    }
  });
  return { approved, logged, output, points: pts, adherence: approved ? done / approved : null };
}

/** What a saved hour's details look like on the wire (the server works out planned, unplanned and review itself). */
export const wire = (m: HourMeta) => (m.status || m.qty != null || m.ref || m.reason
  ? { status: m.status ?? null, qty: m.qty ?? null, ref: m.ref ?? "", reason: m.reason ?? "", ...(m.task ? { task: m.task } : {}) } : null);

// ---------- weekly plan (GET /api/team/plans/week/) ----------

export type PlanState = "submitted" | "approved" | "rejected" | null;
export type WeekStatus = "draft" | "submitted" | "approved" | "partial" | "rejected" | null;

export interface PlanDay {
  day: string; slots: Slot[]; states: PlanState[]; note: string; hours: number; points: number; weekend: boolean;
  editable: boolean; blocked: string | null; approved_hours: number;
  done: { logged: number; hours: number; points: number; adherence: number | null } | null;
}

export interface PlanWeek {
  work: number; plan_sheet: number | null; person: string; photo: string | null; role: string | null; mine: boolean; today: string;
  week: { start: string; end: string; no: number; current: boolean; past: boolean };
  status: WeekStatus; status_label: string; phase: "execution" | "closed" | null;
  plan: { goals: string; submitted_at: string | null; submitted_by: string | null; reviewed_at: string | null; reviewed_by: string | null; review_note: string } | null;
  days: PlanDay[];
  counts: { draft: number; submitted: number; approved: number; rejected: number };
  totals: { hours: number; points: number; approved: number; logged: number; output: number };
  submittable: number; target_hours: number; cutoff: "previous_day" | "same_day"; choices: number[];
  can: { plan: boolean; submit: boolean; withdraw: boolean; copy_last_week: boolean; templates: boolean };
}

export interface PlanTemplate { id: number; name: string; hours: number }

export interface HistoryWeek {
  week_start: string; week_end: string; week_no: number; status: WeekStatus; status_label: string; when: "past" | "current" | "ahead";
  planned_hours: number; approved_hours: number; logged_hours: number; output_hours: number; points: number; pending: number;
  adherence: number | null; reviewed_by: string | null; reviewed_at: string | null;
}

export const STATUS_PILL: Record<Exclude<WeekStatus, null>, "neutral" | "info" | "good" | "warning" | "danger"> = {
  draft: "neutral", submitted: "info", approved: "good", partial: "warning", rejected: "danger",
};
