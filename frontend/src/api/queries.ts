import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type { AdminUser, Today } from "./types";

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

export const trackerSummaryQuery = queryOptions({
  queryKey: ["tracker", "summary", null],
  queryFn: async () => (await api.get<DueFollowUps>("/tracker/summary/")).data,
});
