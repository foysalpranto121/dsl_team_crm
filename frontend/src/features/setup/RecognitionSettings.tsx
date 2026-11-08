import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "@/api/client";
import type { TeamSettings } from "@/api/types";
import { Choice, Switch } from "@/components/ui/form-controls";
import { toast } from "@/components/ui/toaster";
import type { RecognitionConfig } from "../recognition/api";

const PARTS: [keyof RecognitionConfig, string, string][] = [
  ["rings", "Progress rings and forecast", "Day, week and month on My Progress."], ["streaks", "Streaks", "Days closed on time and weeks on target."], ["badges", "Badges", "The five fixed badges."],
  ["wins", "Win celebration and feed", "A moment for each verified win, and the Wins page."], ["reactions", "Reactions", "Reacting to posts on the feed."], ["prompts", "Supervisor prompts", "Nudges to say a word of thanks."],
  ["recap", "Weekly recap", "Last week in short, on My Progress."],
];
const POLICY: [keyof RecognitionConfig, string, string][] = [
  ["show_client", "Show the client's name", "On the win feed. The person and supervisors always see it."], ["show_value", "Show the deal's value", "On the win feed. The person and supervisors always see it."],
];

/** Team setup → Recognition (SRS v0.5 NFR-10: all switchable; D11: what a win shows). None of it changes a score. */
export function RecognitionSettings({ st }: { st: TeamSettings }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (patch: Partial<RecognitionConfig>) => (await api.patch<TeamSettings>("/team/settings/", { recognition: patch })).data,
    onSuccess: () => { ["team-settings", "recognition", "progress", "playbook"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Saved"); },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  const row = ([k, label, hint]: [keyof RecognitionConfig, string, string]) => (
    <Choice key={k} label={label} description={hint} control={<Switch checked={st.recognition[k]} disabled={save.isPending} aria-label={label} onCheckedChange={(v) => save.mutate({ [k]: v })} />} />
  );
  return (
    <section className="card p-5" aria-labelledby="recognition-settings-title">
      <h2 id="recognition-settings-title" className="text-base font-semibold">Recognition</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Encouragement only: nothing here ever changes a score. Each part can be switched off.</p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <fieldset><legend className="label mb-2">What's on</legend><div className="space-y-3">{PARTS.map(row)}</div></fieldset>
        <fieldset><legend className="label mb-2">What a win shows to the team</legend><div className="space-y-3">{POLICY.map(row)}</div></fieldset>
      </div>
    </section>
  );
}
