import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

/* SRS v0.5 §5.5 and §5.9: the lightweight pipeline. Stages and KPI bindings are the team's (Team setup); records are the member's own. */

export type StageKind = "open" | "won" | "lost";
export interface Stage {
  id: number; key: string; name: string; kind: StageKind; position: number; expected_days: number | null; probability: number;
  exit_criteria: string; value_required: boolean; active: boolean; records: number;
}
export type KpiKey = "leads" | "opps" | "clients" | "revenue";
export interface KpiTypeDef { id: number; key: KpiKey; name: string; definition: string; stage: string; stage_name: string; verified_only: boolean; unit: "count" | "money" }
export interface PipelineConfig {
  stages: Stage[]; kpi_types: KpiTypeDef[]; lost_reasons: string[]; currency: string; kpi_mode: "derived" | "manual"; kpi_from: string | null;
  log_types: { key: string; label: string }[];
  /** SRS v0.5 FR-SF4: each stage's default framework (per segment, or for every segment when segment is empty) */
  framework_defaults: { stage: string; segment: string; name: string; steps: number }[];
}
export interface Health { state: "good" | "warning" | "danger"; label: string; fix: string }
/** The record's running framework and its next step (SRS v0.5 §5.7). */
export interface FrameworkSummary {
  framework: string | null; framework_id: number | null; open: number; waiting: number; flagged: boolean;
  next: { id: number; title: string; type: string; due_date: string; status: "open" | "held" } | null;
}
export interface PipelineRecord {
  id: number; company: string; requirement: string; segment: string; stage: string; stage_name: string; stage_kind: StageKind; probability: number;
  days_in_stage: number | null; health: Health | null; verified: boolean; value: string | null; deal_currency: string; deal_value: string | null;
  tender_deadline: string | null; odoo_ref: string; website: string; contact: string; role: string; email: string; phone: string; linkedin: string;
  country: string; industry: string; channel: string; plan: string; last_contacted: string | null; next_follow_up: string | null; next_action: string;
  lead_date: string | null; opp_date: string | null; client_date: string | null; lost_reason: string; win_loss_why: string; win_loss_competitor: string;
  win_loss_lesson: string; notes: string; stage_since: string | null; won_verified_at: string | null; created_at: string; updated_at: string;
  framework: FrameworkSummary | null;
}
export interface LogEntry { id: number; type: string; type_label: string; outcome: string; note: string; day: string; next_date: string | null; by_name: string | null; created_at: string }
export interface Reviews {
  moves: { id: number; record: number; company: string; person: string; owner: number; from: string; to: string; day: string }[];
  wins: { id: number; company: string; person: string; owner: number; requirement: string; value: number | null; day: string | null; why: string }[];
  /** records an outcome rule flagged for stage review (SRS v0.5 FR-SF3) */
  stages: { id: number; record: number; company: string; person: string; owner: number; framework: string; note: string; stage: string }[];
}
export interface Evidence {
  counted: Record<KpiKey, { id: number; company: string; day: string; value: number | null }[]>;
  waiting: { id: number; company: string; value: number | null }[];
}

export const configQuery = queryOptions({
  queryKey: ["pipeline-config"],
  queryFn: async () => (await api.get<PipelineConfig>("/tracker/config/")).data,
  staleTime: 60_000,
});

export const recordsQuery = queryOptions({
  queryKey: ["tracker", "prospects"],
  queryFn: async () => (await api.get<PipelineRecord[]>("/tracker/prospects/")).data,
});

export const logQuery = (id: number) => queryOptions({
  queryKey: ["tracker", "log", id],
  queryFn: async () => (await api.get<LogEntry[]>(`/tracker/prospects/${id}/log/`)).data,
});

/** After a record changes: the pipeline, its log, the weekly KPIs worked out from it, and the screens that show them. */
export function refreshPipeline(qc: QueryClient) {
  ["tracker", "frameworks", "kpi-week", "kpi-evidence", "dashboard", "performance", "pipeline-reviews", "playbook"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** The framework a record entering `stage` gets: the default for its segment, else the stage's default for every segment. */
export function defaultFramework(config: PipelineConfig | undefined, stage: string, segment = "") {
  const all = (config?.framework_defaults ?? []).filter((f) => f.stage === stage);
  const seg = segment.trim().toLowerCase();
  return all.find((f) => f.segment && f.segment.trim().toLowerCase() === seg) ?? all.find((f) => !f.segment) ?? null;
}

/** The fields a move to `stage` still needs, given what the record already has (mirrors the API's rules). A stage with a
 *  default framework sets the next step itself (FR-CL3); unfinished framework steps need a keep-or-drop answer (FR-SF5). */
export function missingFor(stage: Stage, r: Partial<PipelineRecord>, config?: PipelineConfig) {
  const need: ("value" | "next" | "why" | "lost_reason" | "old_steps")[] = [];
  if (stage.value_required && (r.value == null || r.value === "")) need.push("value");
  if (stage.kind === "open" && !(r.next_action?.trim() && r.next_follow_up) && !defaultFramework(config, stage.key, r.segment ?? "")) need.push("next");
  if (r.stage !== stage.key && r.framework && r.framework.open + r.framework.waiting > 0) need.push("old_steps");
  if (stage.kind !== "open" && !r.win_loss_why?.trim()) need.push("why");
  if (stage.kind === "lost" && !r.lost_reason?.trim()) need.push("lost_reason");
  return need;
}

/** Open stages in order, then Won, then Lost: the order of the board and the stepper. */
export function orderedStages(stages: Stage[], activeOnly = true) {
  const rank = { open: 0, won: 1, lost: 2 } as const;
  return stages.filter((s) => !activeOnly || s.active).sort((a, b) => rank[a.kind] - rank[b.kind] || a.position - b.position);
}
