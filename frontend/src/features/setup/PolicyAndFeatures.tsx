import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarSync, Newspaper, Sunrise, Tv } from "lucide-react";
import { api, errorText } from "@/api/client";
import type { Feature, TeamSettings } from "@/api/types";
import { Choice, RadioGroup, RadioGroupItem, Switch } from "@/components/ui/form-controls";
import { toast } from "@/components/ui/toaster";

/** Team setup → Approval policy (SRS v0.5 FR-C8, D1, FR-P6) and Features (§0: V2 features stay off until switched on). */

const FEATURES: { key: Feature; label: string; description: string; icon: typeof Tv }[] = [
  { key: "tv", label: "Office TV mode", description: "Team progress and wins on an office screen.", icon: Tv },
  { key: "huddle", label: "Morning huddle", description: "A ten-minute screen for the daily stand-up.", icon: Sunrise },
  { key: "digest", label: "Weekly management digest", description: "A weekly email for admins and management.", icon: Newspaper },
  { key: "renewals", label: "AMC and renewal tracker", description: "Contracts, renewals and renewal revenue in the Revenue KPI.", icon: CalendarSync },
];

export function PolicyAndFeatures({ st }: { st: TeamSettings }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (patch: Partial<TeamSettings>) => (await api.patch<TeamSettings>("/team/settings/", patch)).data,
    onSuccess: () => { ["team-settings", "board", "entries", "dashboard", "plans-mine"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Saved"); },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5" aria-labelledby="policy-title">
        <h2 id="policy-title" className="text-base font-semibold">Approval policy</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">How plans and hours are approved. Supervisors and admins approve; nobody approves their own.</p>
        <fieldset className="mt-5">
          <legend className="label">Hours logged without an approved plan</legend>
          <RadioGroup value={st.unplanned_mode} onValueChange={(v) => save.mutate({ unplanned_mode: v as TeamSettings["unplanned_mode"] })}>
            <Choice control={<RadioGroupItem value="provisional" />} label="Count them for now"
              description="They count straight away; a supervisor can review, edit or flag them later (recommended)." />
            <Choice control={<RadioGroupItem value="strict" />} label="Count them once approved" description="Strict: they count zero until a supervisor approves them." />
          </RadioGroup>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="label">A day's plan can be made and submitted</legend>
          <RadioGroup value={st.plan_cutoff} onValueChange={(v) => save.mutate({ plan_cutoff: v as TeamSettings["plan_cutoff"] })}>
            <Choice control={<RadioGroupItem value="previous_day" />} label="Until the end of the working day before it" description="The default: plans are made ahead." />
            <Choice control={<RadioGroupItem value="same_day" />} label="Up to the day itself" description="Same-day planning is allowed." />
          </RadioGroup>
        </fieldset>
        <p className="mt-4 text-xs text-muted-foreground">A different task in an approved hour is a deviation: it needs a reason and counts once a supervisor approves it.</p>
      </section>

      <section className="card p-5" aria-labelledby="features-title">
        <h2 id="features-title" className="text-base font-semibold">Features</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Extras beyond the core (SRS Version 2). They're off until you switch them on; switching one off keeps its data.</p>
        <div className="mt-5 space-y-4">
          {FEATURES.map((f) => (
            <Choice key={f.key} label={<span className="inline-flex items-center gap-2"><f.icon className="size-4 text-muted-foreground" aria-hidden />{f.label}</span>}
              description={f.description}
              control={<Switch checked={st[`feature_${f.key}`]} disabled={save.isPending} aria-label={f.label}
                onCheckedChange={(v) => save.mutate({ [`feature_${f.key}`]: v } as Partial<TeamSettings>)} />} />
          ))}
        </div>
      </section>
    </div>
  );
}
