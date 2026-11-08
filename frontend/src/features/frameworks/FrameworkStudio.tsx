import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, History, MoreHorizontal, Package, Plus, Star, Trash2, UserRoundCog, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/api/client";
import type { Task } from "@/api/types";
import { EmptyState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/form-controls";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { configQuery, orderedStages, type Stage } from "../pipeline/api";
import { fieldErrors } from "../pipeline/dialogs";
import {
  frameworksQuery, newKey, packsQuery, previewQuery, refreshFrameworks, STEP_TYPES, stepIcon, teamLoadQuery,
  type Framework, type RuleAction, type RuleDef, type StepDef,
} from "./api";

const ACTIONS: { value: RuleAction; label: string }[] = [
  { value: "retry", label: "Try again" }, { value: "jump", label: "Jump to a step" }, { value: "flag", label: "Flag for stage review" },
];
const DEFAULT_OUTCOMES = ["Connected", "No answer", "Call later", "Not interested", "Done"];

type Draft = Pick<Framework, "name" | "description" | "stage" | "segment" | "active" | "outcomes" | "steps" | "rules">;
const blankStep = (day = 0): StepDef => ({ key: newKey(), title: "", day_offset: day, type: "call", activity: null, resource_url: "", instruction: "", stop_on: [] });
const draftOf = (f: Framework | null, stage: string): Draft => f
  ? { name: f.name, description: f.description, stage: f.stage, segment: f.segment, active: f.active, outcomes: [...f.outcomes], steps: f.steps.map((s) => ({ ...s })), rules: f.rules.map((r) => ({ ...r })) }
  : { name: "", description: "", stage, segment: "", active: true, outcomes: [...DEFAULT_OUTCOMES], steps: [blankStep(0)], rules: [] };

/* ---------- the team's load (FR-SF6) ---------- */

function LoadPanel() {
  const qc = useQueryClient();
  const q = useQuery(teamLoadQuery);
  const [overriding, setOverriding] = useState<{ id: number; name: string } | null>(null);
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: async () => api.post(`/frameworks/load/${overriding!.id}/override/`, { note }),
    onSuccess: () => { refreshFrameworks(qc); setOverriding(null); setNote(""); toast.success("New steps go through again", { description: "The flag still clears by itself once the backlog falls." }); },
  });
  if (!q.data) return null;
  const flagged = q.data.people.filter((p) => p.flag);
  const { threshold_items: n, threshold_days: d } = q.data;
  const limit = `more than ${n} overdue ${n === 1 ? "item" : "items"}, or one waiting over ${d} working ${d === 1 ? "day" : "days"}`;
  if (!flagged.length) return <p className="text-sm text-muted-foreground">Nobody is overloaded right now. A member is flagged with {limit}.</p>;
  return (
    <section className="card overflow-hidden" aria-labelledby="load-title">
      <div className="border-b border-border px-5 py-3">
        <h2 id="load-title" className="text-sm font-semibold">Member overloaded <span className="font-normal text-muted-foreground">· {flagged.length}</span></h2>
        <p className="text-xs text-muted-foreground">Flagged with {limit}. Their new framework steps wait in a queue until they catch up.</p>
      </div>
      <ul className="divide-y divide-border">
        {flagged.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <UserRoundCog className="size-4 shrink-0 text-warning-text" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.overdue} overdue {p.overdue === 1 ? "item" : "items"} · the oldest waited {p.oldest_days} working {p.oldest_days === 1 ? "day" : "days"}
                {p.waiting ? ` · ${p.waiting} new ${p.waiting === 1 ? "step" : "steps"} waiting` : ""} · since {relative(p.flag!.raised_at)}</div>
            </div>
            {p.flag!.overridden ? <Badge tone="outline">Let through by {p.flag!.overridden_by}</Badge>
              : <Button size="sm" variant="secondary" onClick={() => setOverriding({ id: p.flag!.id, name: p.name })}>Let new steps through</Button>}
          </li>
        ))}
      </ul>
      <Dialog open={!!overriding} onOpenChange={(o) => !o && setOverriding(null)}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); act.mutate(); }}>
            <DialogHeader><DialogTitle>Let {overriding?.name}'s new steps through?</DialogTitle>
              <DialogDescription>Their waiting steps join their list now. The flag stays until their overdue items fall back under the limit.</DialogDescription></DialogHeader>
            <DialogBody><Field label="Note" hint="Optional, for the activity log."><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agreed priorities on Sunday" /></Field>
              {act.error && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(act.error)}</p>}</DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setOverriding(null)}>Cancel</Button><Button type="submit" busy={act.isPending}>Let them through</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------- template packs (FR-SF10) ---------- */

function PacksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const packs = useQuery({ ...packsQuery, enabled: open });
  const load = useMutation({
    mutationFn: async (key: string) => (await api.post<{ created: { name: string; stage: string; default: boolean }[]; skipped: { name: string; why: string }[] }>("/frameworks/packs/", { key })).data,
    onSuccess: (r) => {
      refreshFrameworks(qc);
      onOpenChange(false);
      toast.success(`${r.created.length} ${r.created.length === 1 ? "framework" : "frameworks"} added`, { duration: 8000,
        description: [r.created.some((c) => c.default) && "Each is its stage's default where the stage had none.", r.skipped.length && `${r.skipped.length} skipped: ${r.skipped.map((s) => `${s.name} (${s.why})`).join("; ")}`].filter(Boolean).join(" ") });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Template packs</DialogTitle>
          <DialogDescription>Starter frameworks you can load and then edit. Nothing is loaded until you ask for it.</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3">
          {packs.isLoading ? <Skeleton className="h-20" /> : packs.data?.map((p) => (
            <div key={p.key} className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3">
              <Package className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {p.frameworks} frameworks</span></div>
                <p className="text-sm text-muted-foreground">{p.description}</p>
              </div>
              <Button size="sm" variant={p.loaded ? "secondary" : "primary"} busy={load.isPending && load.variables === p.key} onClick={() => load.mutate(p.key)}>
                {p.loaded ? "Load the missing ones" : "Load"}</Button>
            </div>
          ))}
          {load.error && <p className="text-sm text-danger-text" role="alert">{errorText(load.error)}</p>}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- applying a new version to open records (FR-SF7) ---------- */

function ApplyDialog({ fw, onClose }: { fw: Framework | null; onClose: () => void }) {
  const qc = useQueryClient();
  const pv = useQuery({ ...previewQuery(fw?.id ?? 0), enabled: !!fw });
  const apply = useMutation({
    mutationFn: async () => (await api.post<{ records: number }>(`/frameworks/items/${fw!.id}/apply/`)).data,
    onSuccess: (r) => { refreshFrameworks(qc); onClose(); toast.success(`Version ${fw!.version} applied to ${r.records} ${r.records === 1 ? "record" : "records"}`); },
  });
  if (!fw) return null;
  const recs = pv.data?.records ?? [];
  const label = { moved: "Moves", edited: "Changes", added: "New step", removed: "Removed" } as const;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Apply version {fw.version} to open records?</DialogTitle>
          <DialogDescription>Done steps stay as they are. Unfinished steps take the new dates and wording, counted from when each record entered the stage; nothing goes into the past.</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3">
          {pv.isLoading ? <Skeleton className="h-24" /> : !recs.length ? <p className="text-sm text-muted-foreground">Every open record already runs this version.</p> : recs.map((r) => (
            <div key={r.assignment} className="rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-medium">{r.company} <span className="font-normal text-muted-foreground">· {r.person} · on version {r.version}</span></div>
              {r.changes.length ? <ul className="divide-y divide-border text-sm">{r.changes.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <Badge tone={c.change === "removed" ? "warning" : c.change === "added" ? "primary" : "outline"}>{label[c.change]}</Badge>
                  <span className="min-w-0 flex-1">{c.title}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{c.old ? date(c.old, "short") : "—"} → {c.new ? date(c.new, "short") : "—"}</span>
                </li>))}</ul> : <p className="px-3 py-2 text-xs text-muted-foreground">No date changes; it moves to the new version.</p>}
            </div>
          ))}
          {apply.error && <p className="text-sm text-danger-text" role="alert">{errorText(apply.error)}</p>}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Not now</Button>
          <Button busy={apply.isPending} disabled={!recs.length} onClick={() => apply.mutate()}>Apply to {recs.length} {recs.length === 1 ? "record" : "records"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- the editor (FR-SF1–SF3) ---------- */

function OutcomesEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]); setText(""); };
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Outcomes">
        {value.map((o) => (
          <li key={o} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card pl-2.5 pr-1 text-xs">
            {o}<button type="button" onClick={() => onChange(value.filter((x) => x !== o))} disabled={value.length === 1}
              className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={`Remove ${o}`}><X className="size-3" /></button>
          </li>))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add an outcome, e.g. Asked for a quote" aria-label="New outcome" className="max-w-xs" />
        <Button type="button" size="sm" variant="secondary" onClick={add} disabled={!text.trim()}>Add</Button>
      </div>
    </div>
  );
}

function StepEditor({ s, i, n, outcomes, tasks, onChange, onRemove, onMove }: {
  s: StepDef; i: number; n: number; outcomes: string[]; tasks: Task[]; onChange: (s: StepDef) => void; onRemove: () => void; onMove: (d: -1 | 1) => void;
}) {
  const [more, setMore] = useState(!!(s.instruction || s.resource_url || s.activity || s.stop_on.length));
  const Icon = stepIcon(s.type);
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-[5.5rem_10rem_1fr_auto] sm:items-end">
        <Field label="Day">
          <Input type="number" min={0} max={365} inputMode="numeric" value={s.day_offset} onChange={(e) => onChange({ ...s, day_offset: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} aria-label={`Step ${i + 1} day`} />
        </Field>
        <Field label="Type"><SimpleSelect value={s.type} onValueChange={(v) => onChange({ ...s, type: v as StepDef["type"] })} aria-label={`Step ${i + 1} type`}
          options={STEP_TYPES.map((t) => ({ value: t.value, label: t.label }))} /></Field>
        <Field label="Step" required><Input value={s.title} maxLength={120} onChange={(e) => onChange({ ...s, title: e.target.value })} placeholder="e.g. Follow-up call on the proposal" required aria-label={`Step ${i + 1} title`} /></Field>
        <div className="flex gap-1">
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}><ChevronUp /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={i === n - 1} aria-label={`Move step ${i + 1} down`}><ChevronDown /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={onRemove} disabled={n === 1} aria-label={`Remove step ${i + 1}`}><Trash2 /></Button>
        </div>
      </div>
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline" onClick={() => setMore(!more)} aria-expanded={more}>
        <Icon className="size-3" aria-hidden />{more ? "Fewer options" : "Activity, instructions, template, stop conditions"}</button>
      {more && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Activity Type" hint="Optional: the step can then be logged as an hour and earn its points.">
          <SimpleSelect value={s.activity ? String(s.activity) : "none"} onValueChange={(v) => onChange({ ...s, activity: v === "none" ? null : Number(v) })} aria-label={`Step ${i + 1} activity`}
            options={[{ value: "none", label: "None" }, ...tasks.filter((t) => t.active || t.id === s.activity).map((t) => ({ value: String(t.id), label: `${t.name} · ${+t.points} pts` }))]} />
        </Field>
        <Field label="Template or resource link"><Input type="url" value={s.resource_url} maxLength={300} onChange={(e) => onChange({ ...s, resource_url: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Instructions" className="sm:col-span-2"><Textarea value={s.instruction} maxLength={1000} className="min-h-14" onChange={(e) => onChange({ ...s, instruction: e.target.value })} placeholder="What to say or send, what to check" /></Field>
        <fieldset className="sm:col-span-2"><legend className="label mb-1.5">Stop the framework when the outcome is</legend>
          <div className="flex flex-wrap gap-1.5">{outcomes.map((o) => {
            const on = s.stop_on.includes(o);
            return <button key={o} type="button" aria-pressed={on} onClick={() => onChange({ ...s, stop_on: on ? s.stop_on.filter((x) => x !== o) : [...s.stop_on, o] })}
              className={cn("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-primary bg-primary-soft text-primary-text" : "border-border text-muted-foreground hover:border-input")}>{o}</button>;
          })}</div>
        </fieldset>
      </div>}
    </li>
  );
}

function RuleEditor({ r, steps, outcomes, onChange, onRemove }: { r: RuleDef; steps: StepDef[]; outcomes: string[]; onChange: (r: RuleDef) => void; onRemove: () => void }) {
  const stepOpts = steps.map((s, i) => ({ value: s.key, label: `${i + 1}. ${s.title || "Untitled step"}` }));
  const from = steps.findIndex((s) => s.key === r.step_key);
  return (
    <li className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
      <Field label="When the outcome is" className="w-40"><SimpleSelect value={r.outcome} onValueChange={(v) => onChange({ ...r, outcome: v })} aria-label="Outcome" placeholder="Outcome"
        options={outcomes.map((o) => ({ value: o, label: o }))} /></Field>
      <Field label="On" className="w-48"><SimpleSelect value={r.step_key || "any"} onValueChange={(v) => onChange({ ...r, step_key: v === "any" ? "" : v })} aria-label="On step"
        options={[{ value: "any", label: "Any step" }, ...stepOpts]} /></Field>
      <Field label="Do" className="w-48"><SimpleSelect value={r.action} onValueChange={(v) => onChange({ ...r, action: v as RuleAction })} aria-label="Action" options={ACTIONS} /></Field>
      {r.action === "retry" && <>
        <Field label="In (working days)" className="w-32"><Input type="number" min={1} max={60} value={r.retry_days} onChange={(e) => onChange({ ...r, retry_days: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></Field>
        <Field label="Up to (times)" className="w-28"><Input type="number" min={1} max={10} value={r.retry_max} onChange={(e) => onChange({ ...r, retry_max: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></Field>
      </>}
      {r.action === "jump" && <Field label="To" className="w-56"><SimpleSelect value={r.jump_key || undefined} onValueChange={(v) => onChange({ ...r, jump_key: v })} aria-label="Jump to" placeholder="Choose a step"
        options={stepOpts.filter((_, i) => i > from)} /></Field>}
      <Button type="button" size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Remove rule" className="mb-0.5"><Trash2 /></Button>
    </li>
  );
}

function Versions({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["frameworks", "versions", id], queryFn: async () => (await api.get<{ number: number; created_at: string; by: string | null; steps: number }[]>(`/frameworks/items/${id}/versions/`)).data });
  if (!q.data) return <Skeleton className="h-12" />;
  return <ul className="space-y-1 text-sm">{q.data.map((v) => <li key={v.number} className="flex justify-between gap-2"><span>Version {v.number} · {v.steps} {v.steps === 1 ? "step" : "steps"}</span>
    <span className="text-muted-foreground">{date(v.created_at.slice(0, 10), "short")}{v.by ? ` · ${v.by}` : ""}</span></li>)}</ul>;
}

function Editor({ fw, stage, stages, onClose, onSaved }: { fw: Framework | null; stage: string; stages: Stage[]; onClose: () => void; onSaved: (f: Framework) => void }) {
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const [d, setD] = useState<Draft>(() => draftOf(fw, stage));
  const [showVersions, setShowVersions] = useState(false);
  useEffect(() => setD(draftOf(fw, stage)), [fw, stage]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...d, steps: d.steps.map((s) => ({ ...s, title: s.title.trim() })), rules: d.rules.filter((r) => r.outcome) };
      return (fw ? await api.put<Framework>(`/frameworks/items/${fw.id}/`, body) : await api.post<Framework>("/frameworks/items/", body)).data;
    },
    onSuccess: (r) => {
      refreshFrameworks(qc);
      toast.success(fw ? (r.version !== fw.version ? `Saved as version ${r.version}` : "Saved") : `${r.name} created`,
        { description: fw && r.version !== fw.version && fw.records ? "Records already running it keep their steps. You can apply the new version to them." : undefined });
      onSaved(r);
    },
  });
  const err = fieldErrors(save.error);
  const setStep = (i: number, s: StepDef) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const moveStep = (i: number, dir: -1 | 1) => { const s = [...d.steps]; [s[i], s[i + dir]] = [s[i + dir], s[i]]; setD({ ...d, steps: s }); };
  const removeStep = (i: number) => {
    const key = d.steps[i].key;
    setD({ ...d, steps: d.steps.filter((_, j) => j !== i), rules: d.rules.filter((r) => r.step_key !== key && r.jump_key !== key) });
  };
  const setOutcomes = (o: string[]) => setD({ ...d, outcomes: o, steps: d.steps.map((s) => ({ ...s, stop_on: s.stop_on.filter((x) => o.includes(x)) })), rules: d.rules.filter((r) => o.includes(r.outcome)) });
  const ok = !!d.name.trim() && d.steps.length > 0 && d.steps.every((s) => s.title.trim()) && d.rules.every((r) => r.outcome && (r.action !== "jump" || r.jump_key));
  const sorted = d.steps.every((s, i, a) => i === 0 || a[i - 1].day_offset <= s.day_offset);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{fw ? `Edit ${fw.name}` : "New framework"}</SheetTitle>
          <SheetDescription>{fw ? `Version ${fw.version}${fw.records ? ` · running on ${fw.records} ${fw.records === 1 ? "record" : "records"}` : ""}. Changes to the steps make a new version for new records.`
            : "Dated steps a record gets when it enters the stage. Days count working days from that day; weekends and holidays are skipped."}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="fw-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate(); }}>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Framework</legend>
              <Field label="Name" required error={err.name}><Input value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. 14-day follow-up" required /></Field>
              <Field label="Stage" required error={err.stage}><SimpleSelect value={d.stage} onValueChange={(v) => setD({ ...d, stage: v })} aria-label="Stage"
                options={stages.map((s) => ({ value: s.key, label: s.name }))} /></Field>
              <Field label="Segment or product" hint="Optional: only records of this segment get it as their default." error={err.segment}>
                <Input value={d.segment} maxLength={80} onChange={(e) => setD({ ...d, segment: e.target.value })} placeholder="Every record" /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={d.active} onCheckedChange={(v) => setD({ ...d, active: v })} aria-label="Active" />Active</label>
              <Field label="Description" className="sm:col-span-2"><Textarea value={d.description} maxLength={500} className="min-h-14" onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What it's for and when to use it" /></Field>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcomes</legend>
              <p className="mb-2 text-sm text-muted-foreground">What a member can answer when they complete a step.</p>
              <OutcomesEditor value={d.outcomes} onChange={setOutcomes} />
              {err.outcomes && <p className="mt-1 text-sm text-danger-text" role="alert">{err.outcomes}</p>}
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps <span className="font-normal normal-case tracking-normal">· {d.steps.length}</span></legend>
              <p className="mb-2 text-sm text-muted-foreground">Day 0 is the day the record enters the stage. A step is one piece of output, such as a call or an email, not an hour of work.</p>
              <ol className="space-y-2">{d.steps.map((s, i) => <StepEditor key={s.key} s={s} i={i} n={d.steps.length} outcomes={d.outcomes} tasks={tasks.data ?? []}
                onChange={(x) => setStep(i, x)} onRemove={() => removeStep(i)} onMove={(dir) => moveStep(i, dir)} />)}</ol>
              {!sorted && <p className="mt-2 text-xs text-muted-foreground">Steps are saved in day order.</p>}
              {err.steps && <p className="mt-1 text-sm text-danger-text" role="alert">{err.steps}</p>}
              <Button type="button" size="sm" variant="secondary" className="mt-2" disabled={d.steps.length >= 30}
                onClick={() => setD({ ...d, steps: [...d.steps, blankStep((d.steps.at(-1)?.day_offset ?? -1) + 1)] })}><Plus /> Add a step</Button>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome rules</legend>
              <p className="mb-2 text-sm text-muted-foreground">Without a rule, the member just moves on to the next step.</p>
              <ul className="space-y-2">{d.rules.map((r, i) => <RuleEditor key={i} r={r} steps={d.steps} outcomes={d.outcomes}
                onChange={(x) => setD({ ...d, rules: d.rules.map((y, j) => (j === i ? x : y)) })} onRemove={() => setD({ ...d, rules: d.rules.filter((_, j) => j !== i) })} />)}</ul>
              {err.rules && <p className="mt-1 text-sm text-danger-text" role="alert">{err.rules}</p>}
              <Button type="button" size="sm" variant="secondary" className="mt-2"
                onClick={() => setD({ ...d, rules: [...d.rules, { outcome: d.outcomes.find((o) => !d.rules.some((r) => r.outcome === o && !r.step_key)) ?? d.outcomes[0], step_key: "", action: "retry", retry_days: 1, retry_max: 2, jump_key: "" }] })}>
                <Plus /> Add a rule</Button>
            </fieldset>

            {fw && <div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowVersions(!showVersions)} aria-expanded={showVersions}><History /> Version history</Button>
              {showVersions && <div className="mt-2 rounded-lg border border-border p-3"><Versions id={fw.id} /></div>}
            </div>}
            {save.error && !Object.keys(err).some((k) => ["name", "stage", "segment", "outcomes", "steps", "rules"].includes(k)) &&
              <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </form>
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="fw-form" busy={save.isPending} disabled={!ok}>{fw ? "Save" : "Create framework"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- the studio ---------- */

function FrameworkRow({ f, onEdit, onApply }: { f: Framework; onEdit: () => void; onApply: () => void }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: async (a: "default" | "duplicate" | "toggle" | "delete") => {
      if (a === "default") return api.post(`/frameworks/items/${f.id}/default/`);
      if (a === "duplicate") return api.post(`/frameworks/items/${f.id}/duplicate/`);
      if (a === "toggle") return api.patch(`/frameworks/items/${f.id}/`, { active: !f.active });
      return api.delete(`/frameworks/items/${f.id}/`);
    },
    onSuccess: (_, a) => { refreshFrameworks(qc); toast.success({ default: `${f.name} is the default now`, duplicate: "Copy made", toggle: f.active ? "Switched off" : "Switched on", delete: "Deleted" }[a],
      { description: a === "default" ? `Records entering ${f.stage_name}${f.segment ? ` (${f.segment})` : ""} get its steps.` : undefined }); },
    onError: (e) => toast.error("Couldn't do that", { description: errorText(e) }),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Workflow className={cn("size-4 shrink-0", f.active ? "text-primary-text" : "text-subtle-foreground")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onEdit} className="text-sm font-medium hover:underline">{f.name}</button>
          {f.is_default && <Badge tone="success"><Star /> Default</Badge>}
          {f.segment && <Badge tone="outline">{f.segment}</Badge>}
          {!f.active && <Badge tone="neutral">Off</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {f.steps.length} {f.steps.length === 1 ? "step" : "steps"} over {f.steps.at(-1)?.day_offset ?? 0} working days · version {f.version}
          {f.records ? ` · running on ${f.records} ${f.records === 1 ? "record" : "records"}` : ""}{f.description ? ` · ${f.description}` : ""}
        </div>
      </div>
      {!f.is_default && f.active && <Button size="sm" variant="secondary" busy={act.isPending && act.variables === "default"} onClick={() => act.mutate("default")}>Make default</Button>}
      <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`More for ${f.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          {f.records > 0 && <DropdownMenuItem onSelect={onApply}>Apply this version to open records…</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => act.mutate("duplicate")}><Copy /> Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => act.mutate("toggle")}>{f.active ? "Switch off" : "Switch on"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => act.mutate("delete")}><Trash2 /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Framework Studio (SRS v0.5 §5.7, §10.5): supervisors build the step schedules each stage gives its records, and assign
 *  each stage's default. Primary action: assign the default framework. */
export default function FrameworkStudio() {
  const config = useQuery(configQuery);
  const list = useQuery(frameworksQuery);
  const [editing, setEditing] = useState<{ fw: Framework | null; stage: string } | null>(null);
  const [applying, setApplying] = useState<Framework | null>(null);
  const [packs, setPacks] = useState(false);
  const stages = useMemo(() => orderedStages(config.data?.stages ?? []), [config.data]);
  const byStage = useMemo(() => {
    const m: Record<string, Framework[]> = {};
    (list.data ?? []).forEach((f) => (m[f.stage] ??= []).push(f));
    return m;
  }, [list.data]);
  const firstOpen = stages.find((s) => s.kind === "open")?.key ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="Framework Studio" subtitle="Reusable, dated steps for each stage of the sales process. A record entering a stage gets its default framework's steps on working days."
        actions={<>
          <Button variant="secondary" onClick={() => setPacks(true)}><Package /> Template packs</Button>
          <Button onClick={() => setEditing({ fw: null, stage: firstOpen })} disabled={!stages.length}><Plus /> New framework</Button>
        </>} />
      <LoadPanel />
      {config.isLoading || list.isLoading ? <Skeleton className="h-64" /> : list.error ? <p className="text-sm text-danger-text" role="alert">{errorText(list.error)}</p>
        : !list.data?.length ? (
          <div className="card"><EmptyState icon={<Workflow />} title="No frameworks yet"
            action={<Button onClick={() => setPacks(true)}><Package /> Load a template pack</Button>}
            secondary={<Button variant="secondary" onClick={() => setEditing({ fw: null, stage: firstOpen })}><Plus /> Build one</Button>}>
            A framework is a schedule of follow-ups, such as calls, emails and visits, that a record gets when it enters a stage. Start from a template pack and edit it, or build your own.
          </EmptyState></div>
        ) : stages.map((s) => {
          const fws = byStage[s.key] ?? [];
          return (
            <section key={s.key} className="card overflow-hidden" aria-labelledby={`stage-${s.key}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                <h2 id={`stage-${s.key}`} className="text-sm font-semibold">{s.name}</h2>
                <span className="text-xs text-muted-foreground">{fws.length ? `${fws.length} ${fws.length === 1 ? "framework" : "frameworks"}` : "No framework: records entering it get no steps"}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ fw: null, stage: s.key })} aria-label={`Add a framework for ${s.name}`}><Plus /> Add</Button>
              </div>
              {fws.length > 0 && <ul className="divide-y divide-border">{fws.map((f) => <FrameworkRow key={f.id} f={f} onEdit={() => setEditing({ fw: f, stage: f.stage })} onApply={() => setApplying(f)} />)}</ul>}
            </section>
          );
        })}
      {editing && <Editor fw={editing.fw} stage={editing.stage} stages={stages} onClose={() => setEditing(null)}
        onSaved={(f) => { const newVersion = !!editing.fw && f.version !== editing.fw.version && f.records > 0; setEditing(null); if (newVersion) setApplying(f); }} />}
      <ApplyDialog fw={applying} onClose={() => setApplying(null)} />
      <PacksDialog open={packs} onOpenChange={setPacks} />
    </div>
  );
}
