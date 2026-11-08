import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { CalendarClock, CheckCircle2, ExternalLink, Flag, Hourglass, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/form-controls";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fieldErrors } from "../pipeline/dialogs";
import { dayLabel, recordFrameworkQuery, refreshFrameworks, stepIcon, type RecordFramework, type StepInstance, type StepResult } from "./api";

function dueText(s: StepInstance, today: string) {
  if (s.status === "held") return "Waiting";
  if (s.due_date === today) return "Today";
  if (s.overdue) {
    const days = Math.round((Date.parse(today) - Date.parse(s.due_date)) / 864e5);
    return `${days} ${days === 1 ? "day" : "days"} late`;
  }
  return date(s.due_date, "short");
}

/** FR-SF3, FR-SF8: done with an outcome. The step goes into the Client Log and the framework's rule decides what happens next.
 *  The last step of an open record asks for a dated next action (FR-CL3). */
export function CompleteStepDialog({ step, isLast, onClose }: { step: StepInstance | null; isLast?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ outcome: "", note: "", next_action: "", next_date: null as string | null });
  const [needNext, setNeedNext] = useState(false);
  useEffect(() => { if (step) { setF({ outcome: "", note: "", next_action: "", next_date: null }); setNeedNext(!!isLast); } }, [step, isLast]);
  const log = useMutation({
    mutationFn: async (a: { id: number; hour: number }) => (await api.post(`/frameworks/steps/${a.id}/log-hour/`, { hour: a.hour })).data,
    onSuccess: (_, a) => { refreshFrameworks(qc); qc.invalidateQueries({ queryKey: ["entries"] }); toast.success(`Logged in hour ${a.hour + 1}`, { description: "It's in My Day now." }); },
    onError: (e) => toast.error("Couldn't log the hour", { description: errorText(e) }),
  });
  const save = useMutation({
    mutationFn: async () => (await api.post<StepInstance & { result: StepResult; free_hour: number | null }>(`/frameworks/steps/${step!.id}/complete/`,
      { outcome: f.outcome, note: f.note, ...(needNext ? { next_action: f.next_action, next_date: f.next_date } : {}) })).data,
    onSuccess: (r) => {
      refreshFrameworks(qc);
      onClose();
      const opts = { description: r.result.label || "Logged in the Client Log." };
      if (r.free_hour != null && r.activity_name) {
        toast.success(`Done: ${r.title}`, { ...opts, description: `${opts.description} Log it as an hour of ${r.activity_name}?`, duration: 10000,
          action: { label: `Log in hour ${r.free_hour + 1}`, onClick: () => log.mutate({ id: r.id, hour: r.free_hour! }) } });
      } else toast.success(`Done: ${r.title}`, opts);
    },
    onError: (e) => { if (axios.isAxiosError(e) && (e.response?.data as { code?: string })?.code === "next_required") setNeedNext(true); },
  });
  const err = fieldErrors(save.error);
  if (!step) return null;
  const Icon = stepIcon(step.type);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden />{step.title}</DialogTitle>
            <DialogDescription>{step.company} · {step.type_label}{step.attempt > 1 ? ` · try ${step.attempt}` : ""}. How did it go?</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {step.instruction && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground/90">{step.instruction}</p>}
            <fieldset>
              <legend className="label mb-1.5">Outcome <span className="text-danger-text" aria-hidden>*</span></legend>
              <RadioGroup value={f.outcome} onValueChange={(v) => setF({ ...f, outcome: v })} className="flex flex-wrap gap-2" aria-label="Outcome" required>
                {step.outcomes.map((o) => (
                  <label key={o} className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
                    f.outcome === o ? "border-primary bg-primary-soft text-foreground" : "border-border hover:border-input")}>
                    <RadioGroupItem value={o} />{o}
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            <Field label="Note" hint="Optional. It goes into the Client Log with the outcome."><Textarea value={f.note} maxLength={1000} className="min-h-16" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            {needNext && <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm text-muted-foreground">This is the last step for this record. Say what you'll do next and when, so it always has a next step.</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Next step" required error={err.next_action}><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} placeholder="e.g. Book the demo" required /></Field>
                <Field label="When" required error={err.next_date}><DatePicker value={f.next_date} onChange={(v) => setF({ ...f, next_date: v })} aria-label="Next step date" /></Field>
              </div>
            </div>}
            {save.error && !err.next_action && !err.next_date && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!f.outcome || (needNext && (!f.next_date || !f.next_action.trim()))}>Done</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** FR-DP7: a step never vanishes silently. Dropping it needs a reason, which goes into the Client Log. */
function DropStepDialog({ step, isLast, onClose }: { step: StepInstance | null; isLast: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ reason: "", next_action: "", next_date: null as string | null });
  useEffect(() => { if (step) setF({ reason: "", next_action: "", next_date: null }); }, [step]);
  const save = useMutation({
    mutationFn: async () => api.post(`/frameworks/steps/${step!.id}/drop/`, { reason: f.reason, ...(isLast ? { next_action: f.next_action, next_date: f.next_date } : {}) }),
    onSuccess: () => { refreshFrameworks(qc); onClose(); toast.success("Step dropped", { description: "The reason is in the Client Log." }); },
  });
  if (!step) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Drop “{step.title}”?</DialogTitle><DialogDescription>Say why. It goes into the record's Client Log.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Why" required><Input value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. The client prefers email only" required autoFocus /></Field>
            {isLast && <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Next step" required><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} required /></Field>
              <Field label="When" required><DatePicker value={f.next_date} onChange={(v) => setF({ ...f, next_date: v })} aria-label="Next step date" /></Field>
            </div>}
            {save.error && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="danger" busy={save.isPending} disabled={f.reason.trim().length < 3 || (isLast && (!f.next_date || !f.next_action.trim()))}>Drop step</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveStepDialog({ step, onClose }: { step: StepInstance | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [due, setDue] = useState<string | null>(null);
  useEffect(() => { if (step) setDue(step.due_date); }, [step]);
  const save = useMutation({
    mutationFn: async () => (await api.post<StepInstance>(`/frameworks/steps/${step!.id}/reschedule/`, { due_date: due })).data,
    onSuccess: (r) => { refreshFrameworks(qc); onClose(); toast.success(`Moved to ${date(r.due_date, "short")}`, { description: r.due_date !== due ? "That day isn't a working day, so it's on the next one." : undefined }); },
  });
  if (!step) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Move “{step.title}”</DialogTitle><DialogDescription>Pick a new day. Weekends and holidays move to the next working day.</DialogDescription></DialogHeader>
          <DialogBody><Field label="New date" required><DatePicker value={due} onChange={setDue} aria-label="New date" /></Field>
            {save.error && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}</DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={save.isPending} disabled={!due}>Move</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** FR-SF4: pick another approved framework for this one record. */
function PickDialog({ open, onClose, recordId, data }: { open: boolean; onClose: () => void; recordId: number; data: RecordFramework }) {
  const qc = useQueryClient();
  const [fw, setFw] = useState<string>("");
  const [old, setOld] = useState<"keep" | "drop">("drop");
  const open_ = data.steps.filter((s) => s.status === "open" || s.status === "held").length;
  const save = useMutation({
    mutationFn: async () => api.post(`/frameworks/records/${recordId}/pick/`, { framework: Number(fw), old_steps: old }),
    onSuccess: () => { refreshFrameworks(qc); onClose(); toast.success("Framework changed", { description: "Its steps are dated from today." }); },
  });
  const others = data.choices.filter((c) => c.id !== data.assignment?.framework);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Use another framework</DialogTitle><DialogDescription>Only for this record. Your supervisor sets the stage's default.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Framework" required>
              <SimpleSelect value={fw} onValueChange={setFw} placeholder="Choose one" aria-label="Framework"
                options={others.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.steps} ${c.steps === 1 ? "step" : "steps"}${c.segment ? ` · ${c.segment}` : ""}` }))} />
            </Field>
            {open_ > 0 && <fieldset><legend className="label mb-1.5">The {open_} unfinished {open_ === 1 ? "step" : "steps"} of the current framework</legend>
              <RadioGroup value={old} onValueChange={(v) => setOld(v as "keep" | "drop")} className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="drop" />Drop them (noted in the Client Log)</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="keep" />Keep them on my list</label>
              </RadioGroup></fieldset>}
            {save.error && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={save.isPending} disabled={!fw}>Use it</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ s, today, mine, onDone, onDrop, onMove }: { s: StepInstance; today: string; mine: boolean; onDone: () => void; onDrop: () => void; onMove: () => void }) {
  const Icon = stepIcon(s.type);
  const live = s.status === "open" || s.status === "held";
  return (
    <li className="flex gap-3 py-3">
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border",
        s.status === "done" ? "border-success/40 bg-success-soft text-success-text" : live ? "border-border bg-card text-muted-foreground" : "border-border bg-muted text-subtle-foreground")}>
        {s.status === "done" ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-sm font-medium", !live && s.status !== "done" && "text-muted-foreground line-through")}>{s.title}</span>
          <span className="text-xs text-muted-foreground">{dayLabel(s.day_offset)} · {s.type_label}{s.attempt > 1 ? ` · try ${s.attempt}` : ""}</span>
        </div>
        {live && s.instruction && <p className="mt-0.5 text-xs text-muted-foreground">{s.instruction}</p>}
        {s.status === "done" && <p className="mt-0.5 text-xs text-muted-foreground">{s.outcome}{s.note ? ` · ${s.note}` : ""}{s.logged_day ? ` · logged in hour ${(s.logged_hour ?? 0) + 1}` : ""}</p>}
        {(s.status === "dropped" || s.status === "skipped") && <p className="mt-0.5 text-xs text-muted-foreground">{s.status_label}{s.reason ? `: ${s.reason}` : ""}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {live && <Badge tone={s.status === "held" ? "neutral" : s.overdue ? "warning" : s.due_date === today ? "primary" : "outline"}>
            {s.status === "held" ? <Hourglass /> : <CalendarClock />}{dueText(s, today)}</Badge>}
          {s.activity_name && <Badge tone="outline">{s.activity_name}{s.activity_points != null ? ` · ${s.activity_points} pts` : ""}</Badge>}
          {s.resource_url && <a href={s.resource_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Template <ExternalLink className="size-3" aria-hidden /></a>}
        </div>
      </div>
      {mine && live && (
        <div className="flex shrink-0 items-start gap-1">
          {s.status === "open" && <Button size="sm" variant="secondary" onClick={onDone}>Done…</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`More for ${s.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {s.status === "open" && <DropdownMenuItem onSelect={onMove}>Move to another day</DropdownMenuItem>}
              <DropdownMenuItem tone="danger" onSelect={onDrop}>Drop with a reason</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}

/** The record's framework (SRS v0.5 §5.7): the running one, its dated steps, and steps kept from an earlier stage. */
export function StepsPanel({ recordId, open: recordOpen, today }: { recordId: number; open: boolean; today: string }) {
  const q = useQuery(recordFrameworkQuery(recordId));
  const [doing, setDoing] = useState<StepInstance | null>(null);
  const [dropping, setDropping] = useState<StepInstance | null>(null);
  const [moving, setMoving] = useState<StepInstance | null>(null);
  const [picking, setPicking] = useState(false);
  const [history, setHistory] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error || !q.data) return <p className="text-sm text-danger-text" role="alert">{errorText(q.error)}</p>;
  const d = q.data, a = d.assignment;
  const live = d.steps.filter((s) => s.status === "open" || s.status === "held").sort((x, y) => x.due_date.localeCompare(y.due_date) || x.position - y.position);
  const past = d.steps.filter((s) => !(s.status === "open" || s.status === "held")).sort((x, y) => y.position - x.position || y.attempt - x.attempt);
  const lastLive = (s: StepInstance) => recordOpen && live.length === 1 && live[0].id === s.id;
  const others = d.choices.filter((c) => c.id !== a?.framework);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{a ? a.name : "No framework running"}</div>
          <div className="text-xs text-muted-foreground">
            {a ? <>Started {date(a.started_on, "short")} · version {a.version}{a.chosen ? " · picked for this record" : " · the stage default"}</>
              : d.choices.length ? "The stage has frameworks you can use for this record." : "Your supervisor hasn't set up a framework for this stage."}
          </div>
        </div>
        {d.mine && others.length > 0 && <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>{a ? "Use another framework" : "Use a framework"}</Button>}
      </div>
      {a?.review_flag && <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-text" role="status">
        <Flag className="mt-0.5 size-4 shrink-0" aria-hidden /><div><span className="font-medium">Flagged for stage review.</span> <span className="text-foreground/80">{a.review_note}</span></div></div>}
      {d.waiting && live.some((s) => s.status === "held") && <div className="flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm" role="status">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>New steps are waiting while you catch up on overdue items. They join your list, with their dates moved on, as soon as you're back under the limit.</div></div>}
      {live.length ? <ul className="divide-y divide-border">{live.map((s) => <StepRow key={s.id} s={s} today={today} mine={d.mine} onDone={() => setDoing(s)} onDrop={() => setDropping(s)} onMove={() => setMoving(s)} />)}</ul>
        : a ? <p className="text-sm text-muted-foreground">Every step is done.</p> : null}
      {past.length > 0 && <div>
        <Button size="sm" variant="ghost" onClick={() => setHistory(!history)} aria-expanded={history}>{history ? "Hide" : "Show"} finished steps ({past.length})</Button>
        {history && <ul className="divide-y divide-border">{past.map((s) => <StepRow key={s.id} s={s} today={today} mine={false} onDone={() => {}} onDrop={() => {}} onMove={() => {}} />)}</ul>}
      </div>}
      <CompleteStepDialog step={doing} isLast={doing ? lastLive(doing) : false} onClose={() => setDoing(null)} />
      <DropStepDialog step={dropping} isLast={dropping ? lastLive(dropping) : false} onClose={() => setDropping(null)} />
      <MoveStepDialog step={moving} onClose={() => setMoving(null)} />
      <PickDialog open={picking} onClose={() => setPicking(false)} recordId={recordId} data={d} />
    </div>
  );
}

/** Phase 0, Record detail: the primary action is "Complete next step". */
export function NextStepCard({ recordId, open: recordOpen, today, onShowAll }: { recordId: number; open: boolean; today: string; onShowAll: () => void }) {
  const q = useQuery(recordFrameworkQuery(recordId));
  const [doing, setDoing] = useState<StepInstance | null>(null);
  const live = (q.data?.steps ?? []).filter((s) => s.status === "open").sort((x, y) => x.due_date.localeCompare(y.due_date) || x.position - y.position);
  const s = live[0];
  if (!s || !q.data?.mine) return null;
  const Icon = stepIcon(s.type);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Next: {s.title}</div>
        <div className="text-xs text-muted-foreground">{dayLabel(s.day_offset)} of {s.framework} · {dueText(s, today)}{live.length > 1 ? ` · ${live.length - 1} more after this` : ""}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onShowAll}>All steps</Button>
      <Button size="sm" onClick={() => setDoing(s)}>Complete step</Button>
      <CompleteStepDialog step={doing} isLast={recordOpen && live.length === 1 && !(q.data?.steps ?? []).some((x) => x.status === "held")} onClose={() => setDoing(null)} />
    </div>
  );
}
