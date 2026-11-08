import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { StepInstance } from "../frameworks/api";

/* SRS v0.5 §5.8: the Daily Playbook, the member's home screen. Worked out live on the server from the plan, steps, tasks and pipeline. */

export type Group = "fix" | "planned" | "step" | "task" | "carry";
export interface PlaybookItem {
  key: string; group: Group; group_label: string; title: string; detail: string; done: boolean; to: string; sticky: boolean; weight: number;
  source: { type: string | null; id: number | null };
  cta?: string; carried?: boolean; waited?: number; decide?: boolean; acknowledge?: boolean;
  slot?: { hour: number; task: number; status: "done" | "partly" | "not_done" | null; reason: string; other: boolean };
  step?: StepInstance;
  task?: { id: number; title: string; activity: number | null; activity_name: string | null; assigned: boolean; due_date: string };
}
export interface ClosingItem { key: string; label: string; done: boolean; to: string; hint: string; optional?: boolean }
export interface Suggestion { id: number; title: string; why: string; action: string; to: string; feedback: "" | "useful" | "not_useful" }
export interface Reminder { key: string; icon: string; title: string; to: string }
export interface LensPerson { id: number; name: string; work: number; started: boolean; closed: boolean; pct: number | null; yesterday_closed: boolean; overloaded: boolean; stuck: number }
export interface Lens { approvals: number; people: LensPerson[]; unclosed: number; yesterday: string; overloaded: number; stuck: number; prompts: { owner: number; work: number; name: string; text: string }[] }
export interface Day {
  day: string; phase: "morning" | "execute" | "close" | "closed"; phase_labels: { morning: string; execute: string; close: string };
  primary: { kind: "open" | "item" | "close"; label: string; item?: string } | null;
  opened_at: string | null; closed_at: string | null; elapsed_seconds: number; running: boolean; note: string;
  ring: { pct: number | null; done: number; total: number; message: string };
  do_now: PlaybookItem[]; up_next: PlaybookItem[]; done: PlaybookItem[]; counts: Record<Group, number>; suggested: Suggestion[]; reminders: Reminder[]; closing: ClosingItem[];
  light: { free_hours: number; message: string; to: string; action: string } | null;
  lens: Lens | null; has_log: boolean; work: number | null;
}
export interface PastDay { day: string; pct: number | null; closed: boolean; minutes: number }

export const playbookQuery = queryOptions({
  queryKey: ["playbook", "today"],
  queryFn: async () => (await api.get<Day>("/playbook/today/")).data,
  refetchInterval: 60_000,
});
export const playbookHistoryQuery = queryOptions({
  queryKey: ["playbook", "history"],
  queryFn: async () => (await api.get<PastDay[]>("/playbook/history/")).data,
  staleTime: 10 * 60_000,
});

/** After something on the list changed: the list, and the screens that show the same work. */
export function refreshPlaybook(qc: QueryClient) {
  ["playbook", "entries", "dashboard", "performance", "leaderboard", "my-tasks", "tracker", "frameworks", "plan-history", "score-ledger"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export interface PlaybookConfig {
  do_now_cap: number; close_hour: number; weights: { fix: number; planned: number; step: number; task: number; closing: number };
  sources: { fix: boolean; planned: boolean; step: boolean; task: boolean; carry: boolean; suggested: boolean; reminders: boolean };
  closing: { timesheet: boolean; client_log: boolean; missed: boolean; tomorrow: boolean; note: boolean };
  phases: { morning: string; execute: string; close: string }; tone: "warm" | "plain";
}
