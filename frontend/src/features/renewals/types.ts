import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Status, Tone } from "@/components/ui/badge";

/** AMC and renewal tracker (SRS v0.3 §14.6): the shapes the DRF API at /api/renewals/ returns. */

export type Kind = "amc" | "licence" | "software" | "support" | "other";
export type ContractStatus = "open" | "renewed" | "lost";
export type ContractState = "active" | "due" | "expired" | "renewed" | "lost";
export type Stage = "open" | "talking" | "quoted" | "won" | "lost";
export type OpenStage = Extract<Stage, "open" | "talking" | "quoted">;

export interface Person { id: number; name: string; email: string; photo: string | null }

export interface RenewalBrief {
  id: number; stage: Stage; stage_label: string; value: string; next_action: string; next_action_on: string | null; closed_on: string | null;
}

export interface Contract {
  id: number; client: string; product: string; kind: Kind; kind_label: string; start_date: string; end_date: string; value: string;
  terms: string; owner: number | null; owner_info: Person | null; status: ContractStatus; status_label: string; state: ContractState;
  days_left: number; external_id: string; notes: string; previous: number | null; next_term: { id: number; start_date: string; end_date: string } | null;
  renewal: RenewalBrief | null; created_at: string; updated_at: string;
}

export interface Renewal {
  id: number;
  contract: { id: number; client: string; product: string; kind: Kind; kind_label: string; start_date: string; end_date: string; value: string;
    terms: string; notes: string; external_id: string; owner: Person | null };
  stage: Stage; stage_label: string; opened_on: string; window: number; value: string; next_action: string; next_action_on: string | null;
  upsell: string; lost_reason: string; closed_on: string | null; closed_by: string | null; credit_to: string | null;
  days_left: number; due: "overdue" | "today" | "later" | null; can_edit: boolean; updated_at: string;
}

interface Total { count: number; value: number }
export interface Summary {
  today: string; windows: number[]; revenue_weight: number; scope: "all" | "mine";
  contracts: { total: number; open: number };
  upcoming: Total & { days: number };
  at_risk: Total & { days: number; expired: Total };
  renewed_month: Total & { month: string };
  rate: { came_up: number; renewed: number; lost: number; pending: number; rate: number | null; value_rate: number | null; renewed_value: number; lost_value: number };
  by_month: { month: string; open: number; renewed: number; lost: number; count: number }[];
  stages: (Total & { stage: OpenStage; label: string })[];
  upsell: { renewal: number; client: string; product: string; end_date: string; note: string; ideas: { product: string; clients: number }[] }[];
  warnings: { unowned?: number; no_sheet?: string[] };
}

export interface DueRenewals {
  items: { id: number; client: string; product: string; end_date: string; days_left: number; next_action: string; next_action_on: string | null; overdue: boolean }[];
  count: number;
  unowned: number | null;
}

export interface RenewalSettings { windows: number[]; revenue_weight: string; updated_at: string }

export interface ImportResult {
  dry_run: boolean; created: number; updated: number; skipped: number; columns: string[];
  rows: { line: number; client: string; product: string; end_date: string | null; value: number; owner: string | null;
    action: "create" | "update" | "error"; errors: string[]; notes: string[] }[];
}

export const KINDS: { value: Kind; label: string }[] = [
  { value: "amc", label: "AMC (maintenance)" }, { value: "licence", label: "Licence or subscription" }, { value: "software", label: "Software" },
  { value: "support", label: "Support" }, { value: "other", label: "Other" },
];

export const OPEN_STAGES: { value: OpenStage; label: string; description: string }[] = [
  { value: "open", label: "To contact", description: "Nobody has spoken to the client about it yet" },
  { value: "talking", label: "In talks", description: "The client knows it's due; terms are being discussed" },
  { value: "quoted", label: "Quote sent", description: "Waiting for the client's decision" },
];

/** Every query under this key is refetched after a change. */
export const KEY = ["renewals"] as const;

export const STAGE_TONE: Record<Stage, Tone> = { open: "neutral", talking: "info", quoted: "primary", won: "success", lost: "danger" };

export function stateOf(state: ContractState): { status: Status; text: string } {
  switch (state) {
    case "active": return { status: "neutral", text: "Active" };
    case "due": return { status: "info", text: "Up for renewal" };
    case "expired": return { status: "danger", text: "Ended, not renewed" };
    case "renewed": return { status: "good", text: "Renewed" };
    case "lost": return { status: "neutral", text: "Not renewed" };
  }
}

/** "Ends today" · "Ends in 12 days" · "Ended 3 days ago". */
export function endsText(daysLeft: number) {
  if (daysLeft === 0) return "Ends today";
  const n = Math.abs(daysLeft), d = n === 1 ? "day" : "days";
  return daysLeft > 0 ? `Ends in ${n} ${d}` : `Ended ${n} ${d} ago`;
}

/** How urgent an open renewal is: ended (danger), inside the last window (warning), otherwise neutral. */
export function urgency(daysLeft: number, lastWindow: number): Tone {
  return daysLeft < 0 ? "danger" : daysLeft <= lastWindow ? "warning" : "neutral";
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Today in the team's time zone, worked out from an end date and the server's days-left. */
export const teamToday = (endDate: string, daysLeft: number) => iso(addDays(parseISO(endDate), -daysLeft));

/** The next term: starts the day after the current one ends and runs as long. */
export function nextTerm(start: string, end: string) {
  const length = Math.max(differenceInCalendarDays(parseISO(end), parseISO(start)), 27);
  const from = addDays(parseISO(end), 1);
  return { start: iso(from), end: iso(addDays(from, length)) };
}

export const TEMPLATE_CSV = "client,product,kind,start_date,end_date,value,terms,owner_email,external_id,notes\r\n" +
  "Acme Ltd,ERP AMC,AMC,2026-01-01,2026-12-31,120000,Yearly; 10% increase,someone@example.com,SUB-001,\r\n";
