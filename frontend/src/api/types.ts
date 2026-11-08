import type { ScoreEvent } from "../features/scoring/api";

/** SRS v0.5 §3: Member · Supervisor / Team Leader (also approves) · Management (stored as "viewer") · Admin. */
export type Role = "admin" | "supervisor" | "member" | "viewer";
export type Status = "pending" | "approved" | "rejected" | "disabled";

export interface Profile {
  photo_url: string | null;
  position: string;
  job_description: string;
  official_email: string;
  phone: string;
  bio: string;
  is_complete: boolean;
  completed_at: string | null;
  updated_at: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  status: Status;
  role: Role;
  requested_at: string;
  approved_at: string | null;
  profile: Profile;
}

export interface AdminUser extends User {
  approved_by: string | null;
  last_login: string | null;
}

export interface SignInResponse {
  status: Status;
  email?: string;
  name?: string;
  access?: string;
  user?: User;
}

export interface Pace {
  key: "met" | "onpace" | "near" | "behind" | "below" | "early" | "none";
  pct: number | null;
  expected?: number;
}

export interface DashboardRow {
  id: number;
  name: string;
  person: string;
  role: string | null;
  owner_id: number | null;
  start: string;
  week_start: string;
  week_end: string;
  week_hours: number;
  last_week_hours: number;
  avg_week_hours: number | null;
  week_target: number;
  week_status: Pace;
  last_week_status: Pace;
  month_points: number;
  last_month_points: number;
  avg_month_points: number | null;
  month_target: number;
  month_status: Pace;
  ytd_hours: number;
  ytd_points: number;
  today_hours: number;
  kpi_month: { leads: number; opps: number; clients: number; revenue: number; weeks: number };
  kpi_targets: { leads: number; opps: number; clients: number; revenue: number };
}

export interface Task {
  id: number;
  type: string;
  name: string;
  points: string;          // decimal from the API, e.g. "1.00"
  active: boolean;
  position: number;
  counts_as_win: boolean;  // logging it is a win: shown and celebrated on the office TV
  /** SRS v0.5 FR-C3, §7, D2: one slot × its points, or quantity × its points once a supervisor verified the event */
  scoring_mode: "time" | "event";
}

export interface JobRole {
  id: number;
  name: string;
  tasks: number[];
  w_hours: string; w_points: string; w_leads: string; w_opps: string; w_clients: string; w_revenue: string;
  weights_total: number;
}

export interface Sheet {
  id: number;
  name: string;
  kind: "work" | "plan";
  owner: number | null;
  owner_name: string | null;
  person: string;
  role: number | null;
  role_name: string | null;
  target_hours: string; target_points: string; target_leads: string; target_opps: string; target_clients: string; target_revenue: string;
  start_date: string | null;
  position: number;
  archived: boolean;
  mine: boolean;
  updated_at: string;
}

export type Slot = number | null;

/** One logged hour's details (SRS v0.5 FR-T1–T3). review: undefined = counts; pending = waits for a supervisor. */
export interface HourMeta {
  status?: "done" | "partly" | "not_done";
  qty?: number | null;
  ref?: string;
  reason?: string;
  planned?: number | null;
  unplanned?: boolean;
  review?: "pending" | "approved" | "rejected" | "flagged";
  note?: string;
  /** logged from this My Tasks task; assigned ones are pre-approved */
  task?: number;
  assigned?: boolean;
  /** logged from this framework step (SRS v0.5 FR-SF2) */
  step?: number;
}

export interface Entry {
  day: string;
  slots: Slot[];
  meta: (HourMeta | Record<string, never>)[];
  remarks: string;
  /** hours with a task logged; hours = output hours that count */
  logged: number;
  hours: number;
  points: number;
  updated_by: string | null;
  updated_at: string;
}

export interface WeekTotal {
  start: string;
  end: string;
  no: number;
  year: number;
  hours: number;
  points: number;
  target_hours: number;
  status: Pace;
}

export interface EntriesResponse {
  from: string;
  to: string;
  today: string;
  editable: Record<string, boolean>;
  blocked: Record<string, string>;
  entries: Entry[];
  weeks: WeekTotal[];
  totals: { hours: number; points: number };
  choices: number[];
  week_start_dow: number;
  weekend_days: number[];
  count_weekend: boolean;
  lock_days: boolean;
  timezone: string;
  seconds_to_lock: number;
  /** the approved task of each hour, per day (SRS v0.5 FR-T7) */
  planned: Record<string, Slot[]>;
  /** each week's plan status (week start → draft | submitted | approved | partial | rejected) */
  plan_weeks: Record<string, string>;
  unplanned_mode: "provisional" | "strict";
  /** SRS v0.5 §7: what each activity was worth in these months ("2026-10" → task id → points) */
  rates: Record<string, Record<string, number>>;
  /** SRS v0.5 D2, FR-T5: the events logged on these days, and what this person can log */
  events: ScoreEvent[];
  event_choices: { id: number; name: string; points: number }[];
}

export type Feature = "tv" | "huddle" | "digest" | "renewals";

export interface TeamSettings {
  name: string;
  timezone: string;
  lock_days: boolean;
  week_start_dow: number;
  weekend_days: number[];
  count_weekend: boolean;
  currency: string;
  /** SRS v0.5 FR-C8, D1, FR-P6 */
  unplanned_mode: "provisional" | "strict";
  plan_cutoff: "previous_day" | "same_day";
  /** SRS v0.5 §0: V2 features, off until an admin switches them on */
  feature_tv: boolean;
  feature_huddle: boolean;
  feature_digest: boolean;
  feature_renewals: boolean;
  /** SRS v0.5 FR-K2, FR-K5, FR-K7: weekly KPIs from the pipeline (or typed in), the cut-over date, lost reasons */
  kpi_mode: "derived" | "manual";
  kpi_from: string | null;
  lost_reasons: string[];
  /** SRS v0.5 FR-C2, FR-SF6: holidays (framework steps skip them) and the Overloaded limits */
  holidays: string[];
  overload_items: number;
  overload_days: number;
  today: string;
  seconds_to_lock: number;
}

export interface Today {
  today: string;
  timezone: string;
  lock_days: boolean;
  seconds_to_lock: number;
  week_start: string;
  week_no: number;
  my_sheets: { id: number; name: string; kind: "work" | "plan"; filled_today: boolean }[];
}

/** A completed week with no results entered for one work sheet. */
export interface Gap {
  sheet: number;
  person: string;
  weeks: string[];   // week start dates, oldest first
}

/** An automatic or manual copy of the team data, newest first on the server. */
export interface Backup {
  name: string;
  created: string;
  reason: string;
  sheets: number;
  days: number;
  kpi_weeks: number;
}
