import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { TeamSettings } from "@/api/types";
import { ErrorState } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Choice, RadioGroup, RadioGroupItem, Switch } from "@/components/ui/form-controls";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { configQuery, type KpiTypeDef, type Stage } from "../pipeline/api";

/** Team setup → Sales process and weekly KPIs (SRS v0.5 FR-K9, FR-C6, FR-K2, FR-K5, FR-K7). Admins only. */

function useRefresh() {
  const qc = useQueryClient();
  return () => ["pipeline-config", "team-settings", "tracker", "kpi-week", "dashboard", "performance"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
const fail = (e: unknown) => toast.error("Couldn't save", { description: errorText(e) });

function StageRow({ s, first, last, onMove }: { s: Stage; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const refresh = useRefresh();
  const init = { name: s.name, kind: s.kind, expected_days: s.expected_days == null ? "" : String(s.expected_days), probability: String(s.probability),
    exit_criteria: s.exit_criteria, value_required: s.value_required, active: s.active };
  const [f, setF] = useState(init);
  useEffect(() => setF(init), [s]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const save = useMutation({
    mutationFn: async () => (await api.patch(`/tracker/stages/${s.id}/`, { ...f, expected_days: f.expected_days === "" ? null : +f.expected_days, probability: +f.probability || 0 })).data,
    onSuccess: () => { refresh(); toast.success(`${f.name} saved`); }, onError: fail,
  });
  const del = useMutation({ mutationFn: async () => api.delete(`/tracker/stages/${s.id}/`), onSuccess: () => { refresh(); toast.success(`${s.name} deleted`); }, onError: fail });
  return (
    <tr className={s.active ? "" : "opacity-70"}>
      <td className="px-2 py-1.5">
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${s.name} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${s.name} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown /></Button>
        </div>
      </td>
      <td className="px-2 py-1.5"><Input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Stage name" className="h-8 min-w-40" /></td>
      <td className="px-2 py-1.5"><NativeSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Stage["kind"] })} aria-label={`Kind of ${s.name}`} className="h-8 py-0">
        <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></NativeSelect></td>
      <td className="px-2 py-1.5"><Input type="number" min={0} max={365} value={f.expected_days} onChange={(e) => setF({ ...f, expected_days: e.target.value })} aria-label={`Expected days in ${s.name}`} className="num h-8 w-20" /></td>
      <td className="px-2 py-1.5"><Input type="number" min={0} max={100} value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} aria-label={`Probability of ${s.name}`} className="num h-8 w-20" /></td>
      <td className="px-2 py-1.5 text-center"><Switch checked={f.value_required} onCheckedChange={(v) => setF({ ...f, value_required: v })} aria-label={`${s.name} needs a value`} /></td>
      <td className="px-2 py-1.5"><Input value={f.exit_criteria} maxLength={300} onChange={(e) => setF({ ...f, exit_criteria: e.target.value })} aria-label={`Exit criteria for ${s.name}`} className="h-8 min-w-56" /></td>
      <td className="px-2 py-1.5 text-center"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} aria-label={`${s.name} in use`} /></td>
      <td className="num px-2 py-1.5 text-right text-muted-foreground">{s.records}</td>
      <td className="px-2 py-1.5">
        <div className="flex justify-end gap-1">
          {dirty && <Button size="sm" onClick={() => save.mutate()} busy={save.isPending}>Save</Button>}
          {s.records === 0 && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${s.name}`} onClick={() => del.mutate()} busy={del.isPending}><Trash2 /></Button>}
        </div>
      </td>
    </tr>
  );
}

function KpiRow({ k, stages }: { k: KpiTypeDef; stages: Stage[] }) {
  const refresh = useRefresh();
  const init = { name: k.name, definition: k.definition, stage: k.stage, verified_only: k.verified_only };
  const [f, setF] = useState(init);
  useEffect(() => setF(init), [k]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const stage = stages.find((s) => s.key === f.stage);
  const save = useMutation({ mutationFn: async () => (await api.patch(`/tracker/kpi-types/${k.id}/`, f)).data,
    onSuccess: () => { refresh(); toast.success(`${f.name} saved`, { description: "Every week from the cut-over on was worked out again." }); }, onError: fail });
  return (
    <tr>
      <td className="px-2 py-1.5"><Input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label={`Name of the ${k.key} KPI`} className="h-8 min-w-36" /></td>
      <td className="px-2 py-1.5"><NativeSelect value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} aria-label={`Stage counted for ${f.name}`} className="h-8 py-0">
        {stages.filter((s) => s.kind !== "lost").map((s) => <option key={s.key} value={s.key}>reaches {s.name}</option>)}</NativeSelect></td>
      <td className="px-2 py-1.5 text-center"><Switch checked={f.verified_only} disabled={stage?.kind !== "won" && !f.verified_only}
        onCheckedChange={(v) => setF({ ...f, verified_only: v })} aria-label={`${f.name} counts verified wins only`} /></td>
      <td className="px-2 py-1.5"><Input value={f.definition} maxLength={300} onChange={(e) => setF({ ...f, definition: e.target.value })} aria-label={`Definition of ${f.name}`} className="h-8 min-w-64" /></td>
      <td className="px-2 py-1.5 text-right">{dirty && <Button size="sm" onClick={() => save.mutate()} busy={save.isPending}>Save</Button>}</td>
    </tr>
  );
}

export function SalesProcess({ st }: { st: TeamSettings }) {
  const refresh = useRefresh();
  const config = useQuery(configQuery);
  const [newName, setNewName] = useState("");
  const [reasons, setReasons] = useState(st.lost_reasons.join("\n"));
  const [from, setFrom] = useState<string | null>(st.kpi_from);
  useEffect(() => { setReasons(st.lost_reasons.join("\n")); setFrom(st.kpi_from); }, [st]);
  const settings = useMutation({ mutationFn: async (patch: Partial<TeamSettings>) => (await api.patch("/team/settings/", patch)).data,
    onSuccess: () => { refresh(); toast.success("Saved"); }, onError: fail });
  const add = useMutation({ mutationFn: async () => (await api.post("/tracker/stages/", { name: newName.trim() })).data,
    onSuccess: () => { refresh(); setNewName(""); toast.success("Stage added", { description: "It's last in the process; move it into place with the arrows." }); }, onError: fail });
  const order = useMutation({ mutationFn: async (keys: string[]) => (await api.post("/tracker/stages/order/", { keys })).data, onSuccess: refresh, onError: fail });
  const recalc = useMutation({ mutationFn: async () => (await api.post("/tracker/kpis/recalculate/")).data,
    onSuccess: () => { refresh(); toast.success("Weekly KPIs worked out again", { description: "Every week from the cut-over on." }); }, onError: fail });
  if (config.error) return <ErrorState error={config.error} onRetry={() => config.refetch()} />;
  if (!config.data) return <Skeleton className="h-96" />;
  const stages = [...config.data.stages].sort((a, b) => a.position - b.position);
  const moveStage = (i: number, dir: -1 | 1) => {
    const keys = stages.map((s) => s.key);
    [keys[i], keys[i + dir]] = [keys[i + dir], keys[i]];
    order.mutate(keys);
  };
  const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden" aria-labelledby="process-title">
        <div className="px-5 pt-5">
          <h2 id="process-title" className="text-base font-semibold">Sales process</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">The stages a pipeline record moves through. Expected days drive deal health; a stage that needs a value
            asks for the expected value. A stage in use can be switched off but not deleted.</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-y border-border bg-muted/50"><th className={th}><span className="sr-only">Order</span></th><th className={th}>Stage</th><th className={th}>Kind</th>
              <th className={th}>Expected days</th><th className={th}>Probability %</th><th className={`${th} text-center`}>Needs value</th><th className={th}>Exit criteria</th>
              <th className={`${th} text-center`}>In use</th><th className={`${th} text-right`}>Records</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-border">{stages.map((s, i) => <StageRow key={s.id} s={s} first={i === 0} last={i === stages.length - 1} onMove={(d) => moveStage(i, d)} />)}</tbody>
          </table>
        </div>
        <form className="flex flex-wrap items-end gap-2 border-t border-border px-5 py-3" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) add.mutate(); }}>
          <Field label="New stage" className="w-64"><Input value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Site survey" /></Field>
          <Button type="submit" variant="secondary" busy={add.isPending} disabled={!newName.trim()}><Plus /> Add stage</Button>
        </form>
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="card overflow-hidden" aria-labelledby="kpi-title">
          <div className="px-5 pt-5">
            <h2 id="kpi-title" className="text-base font-semibold">Weekly KPIs</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">What each KPI counts. A record counts once per KPI, in the week it first reaches the stage. "Verified" counts a win only
              after a supervisor confirms the work order.</p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-y border-border bg-muted/50"><th className={th}>KPI</th><th className={th}>Counts a record when it</th><th className={`${th} text-center`}>Verified wins only</th>
                <th className={th}>Definition</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-border">{config.data.kpi_types.map((k) => <KpiRow key={k.id} k={k} stages={stages} />)}</tbody>
            </table>
          </div>
          <div className="space-y-4 border-t border-border px-5 py-4">
            <fieldset>
              <legend className="label">How weekly KPIs are counted</legend>
              <RadioGroup value={st.kpi_mode} onValueChange={(v) => settings.mutate({ kpi_mode: v as TeamSettings["kpi_mode"] })}>
                <Choice control={<RadioGroupItem value="derived" />} label="Worked out from the pipeline" description="Recommended: every number has the records behind it." />
                <Choice control={<RadioGroupItem value="manual" />} label="Typed in each week" description="Not recommended: the numbers are labelled unevidenced." />
              </RadioGroup>
            </fieldset>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Count from the week of" hint="Earlier weeks keep the numbers typed in. Pick the first day of a week." className="w-64">
                <DatePicker value={from} onChange={setFrom} placeholder="Every week" aria-label="Count from the week of" /></Field>
              {from !== st.kpi_from && <Button variant="secondary" className="mb-[22px]" onClick={() => settings.mutate({ kpi_from: from })} busy={settings.isPending}>Save date</Button>}
              <Button variant="ghost" className="mb-[22px]" onClick={() => recalc.mutate()} busy={recalc.isPending}><RefreshCw /> Recalculate now</Button>
            </div>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="lost-title">
          <h2 id="lost-title" className="text-base font-semibold">Lost reasons</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">The list members choose from when a deal is lost. One per line.</p>
          <Textarea className="mt-4 min-h-48" value={reasons} onChange={(e) => setReasons(e.target.value)} aria-label="Lost reasons, one per line" />
          <div className="mt-3 flex justify-end">
            <Button onClick={() => settings.mutate({ lost_reasons: reasons.split("\n").map((x) => x.trim()).filter(Boolean) })} busy={settings.isPending}
              disabled={reasons.trim() === st.lost_reasons.join("\n").trim()}>Save reasons</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
