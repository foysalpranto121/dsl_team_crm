import { queryOptions } from "@tanstack/react-query";
import { api } from "@/api/client";

/* SRS v0.5 §5.11: streaks, badges, win celebration and the win feed. None of it changes a score. */

export interface RecognitionConfig { rings: boolean; streaks: boolean; badges: boolean; wins: boolean; reactions: boolean; prompts: boolean; recap: boolean; show_client: boolean; show_value: boolean }
export interface Streak { current: number; best: number }
export interface Badge { key: string; name: string; why: string; earned_on: string | null }
export interface RecognitionMe {
  config: RecognitionConfig; streaks: { days: Streak; weeks: Streak } | null; badges: Badge[] | null; leave: { id: number; day: string; reason: string }[]; mine: boolean;
}
export const recognitionQuery = (work: string | null) => queryOptions({
  queryKey: ["recognition", "me", work],
  queryFn: async () => (await api.get<RecognitionMe>("/recognition/me/", { params: { work: work ?? undefined } })).data,
});

export type ReactionKind = "clap" | "party" | "heart";
export interface Post {
  id: number; kind: "win" | "badge" | "thanks"; day: string; title: string; owner: number; person: string; company: string | null; value: number | null; currency: string; message: string; by: string | null;
  badge: string | null; created_at: string; mine: boolean; reactions: Record<ReactionKind, number>; reacted: ReactionKind[];
}
export const feedQuery = queryOptions({
  queryKey: ["recognition", "feed"],
  queryFn: async () => (await api.get<{ enabled: boolean; reactions: boolean; posts: Post[] }>("/recognition/feed/")).data,
});

export interface Unseen {
  wins: { id: number; company: string; value: number | null; currency: string; message: string; by: string | null; what: string }[];
  badges: { id: number; name: string; why: string }[];
}
export const celebrateQuery = queryOptions({
  queryKey: ["recognition", "celebrate"],
  queryFn: async () => (await api.get<Unseen>("/recognition/celebrate/")).data,
  refetchInterval: 5 * 60_000,
});
