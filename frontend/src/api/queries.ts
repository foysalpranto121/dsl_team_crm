import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type { DueRenewals } from "../features/renewals/types";
import type { AdminUser, TeamSettings, Today } from "./types";

/** Team rules, the approval policy and the feature switches (everyone reads; admins change them in Team setup). */
export const teamSettingsQuery = queryOptions({
  queryKey: ["team-settings"],
  queryFn: async () => (await api.get<TeamSettings>("/team/settings/")).data,
});

/** Queries shared by the app shell and the pages, so they hit one cache entry instead of fetching twice. */

export const todayQuery = queryOptions({
  queryKey: ["today"],
  queryFn: async () => (await api.get<Today>("/team/today/")).data,
});

export const pendingUsersQuery = queryOptions({
  queryKey: ["admin-users", "pending"],
  queryFn: async () => (await api.get<AdminUser[]>("/admin/users/?status=pending")).data,
});

/** The part of the tracker summary the notification bell needs (the Tracker page reads the full object from the same entry). */
export interface DueFollowUps {
  due: { id: number; company: string; next_follow_up: string; next_action: string; overdue: boolean }[];
  due_count: number;
}

/** For the bell (SRS v0.5 FR-N1): hours waiting for your decision, and your own plan this week and next week. */
export interface PlansMine {
  can_plan: boolean; can_approve: boolean; to_review: number | null;
  this_week: { start: string; status: string | null; rejected: number } | null;
  next_week: { start: string; status: string | null; rejected: number; due: boolean } | null;
}

export const plansMineQuery = queryOptions({
  queryKey: ["plans-mine"],
  queryFn: async () => (await api.get<PlansMine>("/team/plans/mine/")).data,
});

/** The signed-in person's renewals whose next step is due (SRS FR-RN2). Under ["renewals"], so every renewal change refreshes it. */
export const renewalsDueQuery = queryOptions({
  queryKey: ["renewals", "due"],
  queryFn: async () => (await api.get<DueRenewals>("/renewals/due/")).data,
});

export const trackerSummaryQuery = queryOptions({
  queryKey: ["tracker", "summary", null],
  queryFn: async () => (await api.get<DueFollowUps>("/tracker/summary/")).data,
});
