import type { Pace } from "@/api/types";

/** Office TV mode (SRS v0.3 §14.5). Shapes match backend/display (serializers.py and services.py). */

export type PanelKey = "progress" | "wins" | "leaders";
export type LeadersMode = "top" | "improvers" | "off";

export const PANELS: { key: PanelKey; label: string; description: string }[] = [
  { key: "progress", label: "Team progress", description: "Today, this week and this month against the team's targets" },
  { key: "wins", label: "Recent wins", description: "Work orders and other wins from the last 30 days" },
  { key: "leaders", label: "Leaders", description: "Top performers or most improved this month (top few only)" },
];

export interface DisplayScreen {
  id: number;
  name: string;
  token_hint: string;
  panels: PanelKey[];
  rotate_seconds: number;
  leaders: LeadersMode;
  leaders_count: number;
  show_values: boolean;
  celebrate: boolean;
  sound: boolean;
  active: boolean;
  last_seen_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Returned only when a screen is created or its link replaced. */
export type DisplayScreenWithToken = DisplayScreen & { token: string };

export interface FeedMetric { value: number; target: number; status: Pace }
export interface FeedKpi { key: "leads" | "opps" | "clients" | "revenue"; label: string; value: number | null; target: number | null; pct: number | null }
export interface FeedWin { id: string; day: string; today: boolean; what: string; person: string; photo: string | null; details: string | null }
export interface FeedLeader { id: number; person: string; role: string | null; photo: string | null; points: number; score?: number | null; change?: number }

export interface Feed {
  screen: { name: string; panels: PanelKey[]; rotate_seconds: number; leaders: LeadersMode; show_values: boolean; celebrate: boolean; sound: boolean };
  team: { name: string; timezone: string; today: string; week_no: number };
  progress: {
    people: number;
    logged_today: number;
    today: { value: number; target: number; workday: boolean };
    week: FeedMetric;
    month: FeedMetric;
    kpis: FeedKpi[];
  };
  wins: { configured: boolean; items: FeedWin[] };
  leaders: { mode: LeadersMode; rows: FeedLeader[] };
  generated_at: string;
}

/** The link a TV opens. The token sits after "#", which browsers never send to a server. */
export const screenLink = (token: string) => `${window.location.origin}/tv#${token}`;
