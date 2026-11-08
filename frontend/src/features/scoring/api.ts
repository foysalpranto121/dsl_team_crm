import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

/* SRS v0.5 §5.4, §7: the score ledger. Every counted hour and verified event is one row with its points pinned; any number opens its rows. */

export type KpiMetric = "leads" | "opps" | "clients" | "revenue";
export const METRIC_LABEL: Record<KpiMetric, string> = { leads: "Qualified leads", opps: "Opportunities", clients: "Clients", revenue: "Revenue" };

export interface LedgerRow {
  id: number; sheet: number; person: string; day: string; slot: number | null; activity: string; category: string; quantity: number; hours: number; points: number;
  source: string; source_label: string; version: number; event: number | null;
}
export interface LedgerGroup { name: string; hours: number; points: number; entries: number }
export interface LedgerResponse {
  from: string; to: string; metric: null; currency: string; rows: LedgerRow[]; truncated: boolean; totals: { hours: number; points: number; entries: number };
  by_category: LedgerGroup[]; by_activity: LedgerGroup[];
}
export interface KpiRow { person: string; sheet: number; week: string; day: string | null; what: string; kind: "record" | "adjust" | "typed" | "renewal"; value: number; record?: number }
export interface KpiResponse { from: string; to: string; metric: KpiMetric; currency: string; rows: KpiRow[]; totals: { value: number; entries: number } }

export const KIND_LABEL: Record<KpiRow["kind"], string> = { record: "From the pipeline", adjust: "Supervisor's adjustment", typed: "Typed in", renewal: "Renewal tracker" };

/** What a number stands for: the drawer shows the entries behind it. */
export interface DrillTarget {
  title: string;
  subtitle?: string;
  /** one person's daily log; empty = the whole team */
  sheet?: number | null;
  from: string;
  to: string;
  /** a KPI number: what it came from, instead of ledger rows */
  metric?: KpiMetric;
  /** a composite score: how it was worked out, for one month */
  score?: { year: number; month: number };
  /** a quarter, a year or the team: the scores it averages */
  scores?: { label: string; score: number | null }[];
}

export const ledgerQuery = (t: DrillTarget) => queryOptions({
  queryKey: ["score-ledger", t.sheet ?? null, t.from, t.to, t.metric ?? null],
  queryFn: async () => (await api.get<LedgerResponse | KpiResponse>("/scoring/ledger/", { params: { sheet: t.sheet ?? undefined, from: t.from, to: t.to, metric: t.metric } })).data,
});

export interface ScoreEvent {
  id: number; sheet: number; person: string; day: string; activity: number; activity_name: string; quantity: number; points: number; evidence: string; note: string;
  status: "pending" | "verified" | "rejected"; status_label: string; decided_by_name: string | null; decided_at: string | null; decision_note: string; record: number | null;
  company: string | null; mine: boolean; created_at: string;
}
export const pendingEventsQuery = queryOptions({
  queryKey: ["score-events", "pending"],
  queryFn: async () => (await api.get<ScoreEvent[]>("/scoring/events/", { params: { scope: "team", status: "pending" } })).data,
  staleTime: 2 * 60_000,
});

export interface ScoringVersion {
  number: number; effective_from: string | null; kind: "base" | "config" | "recalc" | "import" | "restore"; kind_label: string; changes: string[]; reason: string;
  by: string | null; created_at: string; entries: number;
}
export const versionsQuery = queryOptions({
  queryKey: ["score-versions"],
  queryFn: async () => (await api.get<{ versions: ScoringVersion[]; current_month: string }>("/scoring/versions/")).data,
});
export interface RecalcPreview { from: string; rows: { person: string; month: string; points_before: number; points_after: number; score_before: number | null; score_after: number | null }[] }

/** After anything that moves a score: every screen that shows one. */
export function refreshScores(qc: QueryClient) {
  ["dashboard", "performance", "leaderboard", "entries", "plan-history", "board", "score-ledger", "score-events", "score-versions", "playbook"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const pad = (n: number) => String(n).padStart(2, "0");
/** First and last day of a month, as ISO dates. month: 1–12. */
export function monthRange(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}
