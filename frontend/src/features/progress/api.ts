import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Suggestion } from "../playbook/api";

/* SRS v0.5 §5.9, §5.11, §5.12: the Weekly Review, My Progress and the AI Coach's reading of the numbers. */

export type MetricKey = "hours" | "points" | "leads" | "opps" | "clients" | "revenue";
export interface Metric {
  key: MetricKey; label: string; means: string; period: "week" | "month"; actual: number; target: number; status: string; status_label: string; pct: number | null; gap: string;
  action: { label: string; to: string } | null; weight: number; month_actual: number; month_target: number; projected: { mid: number; low: number; high: number } | null;
}
export interface Recap {
  week_start: string; week_end: string; hours: number; points: number; kpis: Record<"leads" | "opps" | "clients" | "revenue", number>; hours_before: number; points_before: number;
  wins: { what: string; details: string | null; day: string }[]; best_day: { day: string; hours: number; points: number } | null; improved: string[]; adherence: number | null; approved_hours: number;
}
export interface Analysis {
  from: string; to: string; hours: number; points: number; points_per_hour: number | null; mix: { category: string; hours: number; share: number; expected: number }[]; planned_hours: number; completed_hours: number;
  adherence: number | null; logged_hours: number; deviations: number; deviation_rate: number | null; calls_per_lead: number | null; calls: number; flags: { kind: string; day: string; text: string }[];
}
export interface Progress {
  person: string; work: number; mine: boolean; today: string; month: string; currency: string; rings: Record<"day" | "week" | "month", { value: number; target: number; unit: string }>; score: number | null; version: number | null;
  forecast: { key: string | null; units: number; text: string } | null; metrics: Metric[]; biggest_gap: { key: string; text: string } | null; coach: boolean;
  catch_up: { chain: string[]; text: string; basis: string; average_deal: number | null } | null; analysis: Analysis | null; suggested: Suggestion[]; recap: Recap;
  review: { week_start: string; submitted: boolean; due: boolean };
}
export const progressQuery = (work: string | null) => queryOptions({
  queryKey: ["progress", "me", work],
  queryFn: async () => (await api.get<Progress>("/progress/me/", { params: { work: work ?? undefined } })).data,
});

export interface Deal { record: number; company: string; stage: string; stage_kind: string; summary: string; next_action: string; next_date: string | null; verified: boolean; entries: number }
export interface Review {
  week_start: string; week_end: string; week_no: number; today: string; current: boolean; person: string; work: number; mine: boolean;
  kpi: { numbers: Record<"leads" | "opps" | "clients" | "revenue", number>; derived: boolean; confirmed: boolean; entered: boolean; waiting: { id: number; company: string; value: number | null }[]; currency: string };
  deals: Deal[]; deals_confirmed_at: string | null; recap: Recap; focus: string; focus_options: string[]; last_focus: string;
  next_plan: { week_start: string; status: string | null; status_label: string; planned_hours: number; sent_hours: number; unsent_hours: number; done: boolean; target_hours: number };
  steps: { kpi: boolean; deals: boolean; focus: boolean; plan: boolean }; submitted_at: string | null; ready: boolean;
}
export const reviewQuery = (week: string | null, work: string | null) => queryOptions({
  queryKey: ["progress", "review", week, work],
  queryFn: async () => (await api.get<Review>("/progress/review/", { params: { week: week ?? undefined, work: work ?? undefined } })).data,
});

export interface TeamRow {
  work: number; person: string; role: string | null; hours: number; hours_target: number; points: number; leads: number; opps: number; clients: number; revenue: number; kpi_confirmed: boolean; reviewed: boolean;
  focus: string; plan_status: string; plan_sent: boolean; deals_touched: number; stuck: number; wins: number;
}
export interface TeamReview {
  week_start: string; week_end: string; week_no: number; today: string; current_week_start: string; currency: string; rows: TeamRow[]; totals: Record<string, number>; reviewed: number; plans_sent: number;
  wins: { what: string; person: string; day: string }[];
}
export const teamReviewQuery = (week: string | null) => queryOptions({
  queryKey: ["progress", "team", week],
  queryFn: async () => (await api.get<TeamReview>("/progress/team-review/", { params: { week: week ?? undefined } })).data,
});

export interface Brief { day: string; actions: { text: string; why: string; to: string }[]; members: { work: number; person: string; lines: { text: string; to: string }[] }[] }
export const briefQuery = queryOptions({
  queryKey: ["progress", "brief"],
  queryFn: async () => (await api.get<Brief | null>("/progress/brief/")).data,
  staleTime: 5 * 60_000,
});

export interface RecordCoachData {
  next: { text: string; due: string | null; from: "framework" | "record" }; last_contact: string | null; days_in_stage: number | null; stage: string; expected_days: number | null; exit_criteria: string;
  similar: { outcome: "Won" | "Lost"; who: string; why: string; lesson: string; day: string | null }[];
}
export const recordCoachQuery = (id: number) => queryOptions({
  queryKey: ["progress", "record", id],
  queryFn: async () => (await api.get<RecordCoachData | null>(`/progress/records/${id}/coach/`)).data,
});

export function refreshProgress(qc: QueryClient) {
  ["progress", "playbook", "kpi-week", "dashboard", "performance", "plan-week", "plan-history", "plans-mine"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export const PILL: Record<string, "good" | "warning" | "danger" | "info" | "neutral"> = { met: "good", onpace: "good", near: "warning", behind: "danger", below: "danger", early: "info", none: "neutral" };
