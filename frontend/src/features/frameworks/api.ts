import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { CalendarCheck, ClipboardList, FileText, Mail, MapPin, MessageCircle, MonitorPlay, Phone, Wrench, type LucideIcon } from "lucide-react";
import { api } from "@/api/client";

/* SRS v0.5 §5.7 Stage Frameworks: reusable, dated step schedules per pipeline stage. */

export type StepType = "call" | "email" | "whatsapp" | "visit" | "demo" | "proposal" | "prep" | "custom";
export const STEP_TYPES: { value: StepType; label: string; icon: LucideIcon }[] = [
  { value: "call", label: "Call", icon: Phone }, { value: "email", label: "Email", icon: Mail }, { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "visit", label: "Visit", icon: MapPin }, { value: "demo", label: "Demo", icon: MonitorPlay }, { value: "proposal", label: "Proposal task", icon: FileText },
  { value: "prep", label: "Internal prep", icon: ClipboardList }, { value: "custom", label: "Custom", icon: Wrench },
];
export const stepIcon = (t: string) => STEP_TYPES.find((x) => x.value === t)?.icon ?? CalendarCheck;

export interface StepDef {
  key: string; title: string; day_offset: number; type: StepType; activity: number | null; activity_name?: string | null; activity_points?: number | null;
  resource_url: string; instruction: string; stop_on: string[];
}
export type RuleAction = "retry" | "jump" | "flag";
export interface RuleDef { outcome: string; step_key: string; action: RuleAction; retry_days: number; retry_max: number; jump_key: string }
export interface Framework {
  id: number; name: string; description: string; stage: string; stage_name: string; stage_kind: "open" | "won" | "lost"; segment: string; active: boolean;
  is_default: boolean; version: number; outcomes: string[]; pack: string; steps: StepDef[]; rules: RuleDef[]; records: number;
  updated_by_name: string | null; updated_at: string;
}
export type StepStatus = "held" | "open" | "done" | "dropped" | "skipped";
export interface StepInstance {
  id: number; record: number; company: string; framework: string; assignment: number; step_key: string; position: number; attempt: number; title: string;
  type: StepType; type_label: string; day_offset: number; activity: number | null; activity_name: string | null; activity_points: number | null;
  resource_url: string; instruction: string; stop_on: string[]; due_date: string; status: StepStatus; status_label: string; outcome: string; note: string;
  reason: string; done_at: string | null; logged_day: string | null; logged_hour: number | null; overdue: boolean; outcomes: string[];
}
export interface RecordFramework {
  assignment: { id: number; framework: number; name: string; version: number; latest: number; chosen: boolean; started_on: string; stage: string;
    outcomes: string[]; review_flag: boolean; review_note: string } | null;
  steps: StepInstance[];
  choices: { id: number; name: string; segment: string; is_default: boolean; steps: number; description: string }[];
  waiting: boolean;
  mine: boolean;
}
export interface TeamLoad {
  today: string; threshold_items: number; threshold_days: number;
  people: { id: number; name: string; overdue: number; oldest_days: number; open_steps: number; waiting: number;
    flag: { id: number; raised_at: string; overridden: boolean; overridden_by: string; note: string } | null }[];
}
export interface MyLoad { overdue: number; oldest_days: number; flagged: boolean; waiting: number; overridden: boolean; threshold_items: number; threshold_days: number }
export interface Pack { key: string; name: string; description: string; frameworks: number; loaded: boolean }
export interface Preview { version: number; records: { assignment: number; record: number; company: string; person: string; version: number;
  changes: { title: string; old: string | null; new: string | null; change: "moved" | "edited" | "added" | "removed" }[] }[] }
export interface StepResult { action: "next" | "retry" | "jump" | "flag" | "stop"; label: string }

export const frameworksQuery = queryOptions({
  queryKey: ["frameworks", "list"],
  queryFn: async () => (await api.get<Framework[]>("/frameworks/items/")).data,
});
export const recordFrameworkQuery = (id: number) => queryOptions({
  queryKey: ["frameworks", "record", id],
  queryFn: async () => (await api.get<RecordFramework>(`/frameworks/records/${id}/`)).data,
});
export const teamLoadQuery = queryOptions({
  queryKey: ["frameworks", "load"],
  queryFn: async () => (await api.get<TeamLoad>("/frameworks/load/")).data,
  staleTime: 2 * 60_000,
});
export const myLoadQuery = queryOptions({
  queryKey: ["frameworks", "load", "me"],
  queryFn: async () => (await api.get<MyLoad>("/frameworks/load/me/")).data,
  staleTime: 2 * 60_000,
});
export const packsQuery = queryOptions({
  queryKey: ["frameworks", "packs"],
  queryFn: async () => (await api.get<Pack[]>("/frameworks/packs/")).data,
});
export const previewQuery = (id: number) => queryOptions({
  queryKey: ["frameworks", "preview", id],
  queryFn: async () => (await api.get<Preview>(`/frameworks/items/${id}/preview/`)).data,
});

/** After a step or framework changes: the frameworks, and the pipeline whose next steps they set. */
export function refreshFrameworks(qc: QueryClient) {
  ["frameworks", "tracker", "pipeline-config", "pipeline-reviews", "kpi-week", "playbook"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export const newKey = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
export const dayLabel = (n: number) => `Day ${n}`;
