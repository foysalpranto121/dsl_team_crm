import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { TeamSettings } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Choice, Switch } from "@/components/ui/form-controls";
import { Field, Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import type { PlaybookConfig } from "../playbook/api";

const SOURCES: [keyof PlaybookConfig["sources"], string, string][] = [
  ["fix", "Fix now", "Sent-back plans, new leads, overdue approvals and KPIs."], ["planned", "Planned hours", "Today's approved plan."], ["step", "Steps due today", "Framework steps and dated next actions."],
  ["task", "My Tasks", "Personal and assigned tasks due today."], ["carry", "Carried over", "Unfinished items from earlier days."], ["suggested", "Suggestions (AI Coach)", "Up to three a day. Rules only; the Playbook works the same without them."],
  ["reminders", "Reminders", "Tender deadlines, meetings, KPIs due, approvals pending."],
];
const CLOSING: [keyof PlaybookConfig["closing"], string][] = [["timesheet", "Timesheet complete"], ["client_log", "Client Log updated"], ["missed", "Missed hours explained"], ["tomorrow", "Tomorrow's plan submitted"], ["note", "Day note (optional)"]];
const WEIGHTS: [keyof PlaybookConfig["weights"], string][] = [["fix", "Fix now"], ["planned", "Planned hour"], ["step", "Step"], ["task", "Task"], ["closing", "Closing item"]];

/** Team setup → Daily Playbook (SRS v0.5 FR-DP11): sources, weights, caps, closing items, phase labels and message tone. */
export function PlaybookSettings({ st }: { st: TeamSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PlaybookConfig>(st.playbook);
  useEffect(() => setF(st.playbook), [st.playbook]);
  const dirty = JSON.stringify(f) !== JSON.stringify(st.playbook);
  const save = useMutation({
    mutationFn: async () => (await api.patch<TeamSettings>("/team/settings/", { playbook: f })).data,
    onSuccess: () => { ["team-settings", "playbook"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Saved"); },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  return (
    <section className="card p-5" aria-labelledby="playbook-settings-title">
      <h2 id="playbook-settings-title" className="text-base font-semibold">Daily Playbook</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">What each person's home screen shows. The day ring never changes a score.</p>
      <form className="mt-4 space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-5 lg:grid-cols-2">
          <fieldset><legend className="label mb-2">What goes on the list</legend>
            <div className="space-y-3">{SOURCES.map(([k, label, hint]) => <Choice key={k} label={label} description={hint}
              control={<Switch checked={f.sources[k]} aria-label={label} onCheckedChange={(v) => setF({ ...f, sources: { ...f.sources, [k]: v } })} />} />)}</div>
          </fieldset>
          <div className="space-y-5">
            <fieldset><legend className="label mb-2">Closing checklist</legend>
              <div className="space-y-3">{CLOSING.map(([k, label]) => <Choice key={k} label={label}
                control={<Switch checked={f.closing[k]} aria-label={label} onCheckedChange={(v) => setF({ ...f, closing: { ...f.closing, [k]: v } })} />} />)}</div>
            </fieldset>
            <fieldset><legend className="label mb-2">How much each counts on the day ring</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{WEIGHTS.map(([k, label]) => <Field key={k} label={label}>
                <Input type="number" min={0} max={10} inputMode="numeric" value={f.weights[k]} onChange={(e) => setF({ ...f, weights: { ...f.weights, [k]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })} /></Field>)}</div>
            </fieldset>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Most items in Do now" className="lg:col-span-1"><Input type="number" min={1} max={30} inputMode="numeric" value={f.do_now_cap} onChange={(e) => setF({ ...f, do_now_cap: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></Field>
          <Field label="Close the day from (hour)" className="lg:col-span-1"><Input type="number" min={0} max={23} inputMode="numeric" value={f.close_hour} onChange={(e) => setF({ ...f, close_hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} /></Field>
          <Field label="Message tone" className="lg:col-span-1"><SimpleSelect value={f.tone} onValueChange={(v) => setF({ ...f, tone: v as PlaybookConfig["tone"] })} aria-label="Message tone" options={[{ value: "warm", label: "Warm" }, { value: "plain", label: "Plain" }]} /></Field>
          {(["morning", "execute", "close"] as const).map((k) => <Field key={k} label={`Phase: ${{ morning: "first", execute: "second", close: "last" }[k]}`} className="lg:col-span-1">
            <Input value={f.phases[k]} maxLength={30} onChange={(e) => setF({ ...f, phases: { ...f.phases, [k]: e.target.value } })} required /></Field>)}
        </div>
        <Button type="submit" busy={save.isPending} disabled={!dirty}>Save Playbook settings</Button>
      </form>
    </section>
  );
}
