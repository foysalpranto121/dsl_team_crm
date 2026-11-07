import { useQuery } from "@tanstack/react-query";
import { teamSettingsQuery } from "@/api/queries";
import type { Feature } from "@/api/types";

export type Features = Record<Feature, boolean>;

/** Which V2 features are switched on (SRS v0.5 §0: all off until an admin switches them on in Team setup). */
export function useFeatures(): Features {
  const s = useQuery({ ...teamSettingsQuery, staleTime: 5 * 60_000 }).data;
  return { tv: !!s?.feature_tv, huddle: !!s?.feature_huddle, digest: !!s?.feature_digest, renewals: !!s?.feature_renewals };
}
