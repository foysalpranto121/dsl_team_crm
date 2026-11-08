import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { AlertCircle, BellRing, CalendarClock, Check, ChevronDown, ChevronRight, Circle, ClipboardCheck, Clock, Flame, History, Lightbulb, Plus, Sparkles, ThumbsDown, ThumbsUp, Timer, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorText } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/form-controls";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Progress, ProgressRing, toneForRatio } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompleteStepDialog } from "../frameworks/StepsPanel";
import { recordsQuery } from "../pipeline/api";
import { recognitionQuery } from "../recognition/api";
import { MorningBrief } from "../progress/Coach";
import { playbookHistoryQuery, playbookQuery, refreshPlaybook, type Day, type PlaybookItem, type Suggestion } from "./api";

const TAP = "max-sm:h-11";   // §10.4: touch targets ≥ 44 px on a phone

function useDay() {
  const qc = useQueryClient();
  const set = (d: Day) => { qc.setQueryData(playbookQuery.queryKey, d); refreshPlaybook(qc); };
  return { qc, set };
}

/* ---------- FR-DP10: the small stopwatch ---------- */

function Stopwatch({ seconds, running }: { seconds: number; running: boolean }) {
  const at = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => { at.current = Date.now(); }, [seconds]);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [running]);
  const total = Math.max(0, seconds + (running ? (Date.now() - at.current) / 1000 : 0));
  const text = `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
  return <Badge tone="outline"><Timer aria-hidden /><span className="tabular-nums">{text}</span><span className="sr-only">{running ? "since you started your day" : "from start to close"}</span></Badge>;
}

/* ---------- FR-DP1: the three phases ---------- */

function Phases({ d }: { d: Day }) {
  const now = d.phase === "closed" ? 3 : d.phase === "close" ? 2 : d.phase === "execute" ? 1 : 0;
  const names = [d.phase_labels.morning, d.phase_labels.execute, d.phase_labels.close];
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="The phases of the day">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3 text-subtle-foreground" aria-hidden />}
          <span aria-current={i === now ? "step" : undefined} className={cn(i === now ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {i < now && <Check className="mr-0.5 inline size-3 text-success-text" aria-hidden />}{n}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- small dialogs ---------- */

function NotDoneDialog({ item, onClose }: { item: PlaybookItem | null; onClose: () => void }) {
  const { set } = useDay();
  const [reason, setReason] = useState("");
  useEffect(() => { if (item) setReason(""); }, [item]);
  const save = useMutation({
    mutationFn: async () => (await api.post<Day>("/playbook/slot/", { hour: item!.slot!.hour, status: "not_done", reason })).data,
    onSuccess: (d) => { set(d); onClose(); toast.success("Noted", { description: "The reason stays with the plan." }); },
  });
  if (!item) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Why wasn't it done?</DialogTitle><DialogDescription>{item.title}</DialogDescription></DialogHeader>
          <DialogBody><Field label="Reason" required><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The client postponed" required autoFocus /></Field>
            {save.error && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}</DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={save.isPending} disabled={reason.trim().length < 3}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** P4: move a carried step or task to another day. */
function RescheduleDialog({ item, today, onClose }: { item: PlaybookItem | null; today: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [due, setDue] = useState<string | null>(null);
  useEffect(() => { if (item) setDue(today); }, [item, today]);
  const save = useMutation({
    mutationFn: async () => (item!.step ? api.post(`/frameworks/steps/${item!.step.id}/reschedule/`, { due_date: due }) : api.patch(`/tasks/items/${item!.task!.id}/`, { due_date: due })),
    onSuccess: () => { refreshPlaybook(qc); onClose(); toast.success(`Moved to ${date(due, "short")}`); },
  });
  if (!item) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Move to another day</DialogTitle><DialogDescription>{item.title}</DialogDescription></DialogHeader>
          <DialogBody><Field label="New date" required><DatePicker value={due} onChange={setDue} aria-label="New date" /></Field>
            {save.error && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}</DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={save.isPending} disabled={!due}>Move</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** P4, FR-DP7: dropping needs a reason, and it's logged. The last step of an open record asks what comes next (FR-CL3). */
function DropDialog({ item, onClose }: { item: PlaybookItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ reason: "", next_action: "", next_date: null as string | null });
  const [needNext, setNeedNext] = useState(false);
  useEffect(() => { if (item) { setF({ reason: "", next_action: "", next_date: null }); setNeedNext(false); } }, [item]);
  const save = useMutation({
    mutationFn: async () => (item!.step
      ? api.post(`/frameworks/steps/${item!.step.id}/drop/`, { reason: f.reason, ...(needNext ? { next_action: f.next_action, next_date: f.next_date } : {}) })
      : api.post(`/tasks/items/${item!.task!.id}/drop/`, { reason: f.reason })),
    onSuccess: () => { refreshPlaybook(qc); onClose(); toast.success("Dropped", { description: item?.step ? "The reason is in the Client Log." : undefined }); },
    onError: (e) => { if (axios.isAxiosError(e) && (e.response?.data as { code?: string })?.code === "next_required") setNeedNext(true); },
  });
  if (!item) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Drop “{item.title}”?</DialogTitle><DialogDescription>Say why. It stays on record.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Why" required><Input value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} required autoFocus /></Field>
            {needNext && <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Next step" required><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} required /></Field>
              <Field label="When" required><DatePicker value={f.next_date} onChange={(v) => setF({ ...f, next_date: v })} aria-label="Next step date" /></Field>
            </div>}
            {save.error && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="danger" busy={save.isPending} disabled={f.reason.trim().length < 3 || (needNext && (!f.next_date || !f.next_action.trim()))}>Drop</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- one item (§10.4: checkbox + one action) ---------- */

type Act = { doStep: (i: PlaybookItem) => void; notDone: (i: PlaybookItem) => void; move: (i: PlaybookItem) => void; drop: (i: PlaybookItem) => void };

function ItemCard({ item, act, highlight }: { item: PlaybookItem; act: Act; highlight: boolean }) {
  const { qc, set } = useDay();
  const undo = useMutation({ mutationFn: async (hour: number) => (await api.post<Day>("/playbook/slot/", { hour, status: "undo" })).data, onSuccess: set });
  const slot = useMutation({
    mutationFn: async (status: "done" | "partly") => (await api.post<Day>("/playbook/slot/", { hour: item.slot!.hour, status })).data,
    onSuccess: (d, status) => { set(d); toast.success(status === "done" ? `${item.title}: done` : `${item.title}: partly done`, { action: { label: "Undo", onClick: () => undo.mutate(item.slot!.hour) } }); },
    onError: (e) => toast.error("Couldn't save that", { description: errorText(e) }),
  });
  const log = useMutation({
    mutationFn: async (a: { id: number; hour: number }) => api.post(`/tasks/items/${a.id}/log/`, { hour: a.hour }),
    onSuccess: (_, a) => { refreshPlaybook(qc); toast.success(`Logged in hour ${a.hour + 1}`); },
    onError: (e) => toast.error("Couldn't log it", { description: errorText(e) }),
  });
  const taskDone = useMutation({
    mutationFn: async () => (await api.post<{ id: number; title: string; free_hour: number | null; activity_name: string | null }>(`/tasks/items/${item.task!.id}/done/`)).data,
    onSuccess: (r) => {
      refreshPlaybook(qc);
      if (r.free_hour != null) toast.success(`Done: ${r.title}`, { description: `Log it as an hour of ${r.activity_name}?`, duration: 10000, action: { label: `Log in hour ${r.free_hour + 1}`, onClick: () => log.mutate({ id: r.id, hour: r.free_hour! }) } });
      else toast.success(`Done: ${r.title}`);
    },
    onError: (e) => toast.error("Couldn't finish it", { description: errorText(e) }),
  });
  const plan = useMutation({
    mutationFn: async () => (await api.post<{ day: string; hour: number }>("/playbook/add-to-plan/", { type: item.step ? "step" : "task", id: item.step ? item.step.id : item.task!.id })).data,
    onSuccess: (r) => { refreshPlaybook(qc); qc.invalidateQueries({ queryKey: ["plan-week"] }); toast.success(`In your plan for ${date(r.day, "short")}, hour ${r.hour + 1}`, { description: "As a draft. Submit the plan when you're ready." }); },
    onError: (e) => toast.error("Couldn't add it", { description: errorText(e) }),
  });
  const letGo = useMutation({
    mutationFn: async () => (await api.post<Day>("/playbook/let-go/", { key: item.key })).data,
    onSuccess: set, onError: (e) => toast.error("Couldn't save that", { description: errorText(e) }),
  });
  const id = `item-${item.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <li id={id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors", highlight && "bg-primary-soft/60")}>
      {item.task
        ? <Checkbox className="mt-0.5" checked={false} disabled={taskDone.isPending} onCheckedChange={() => taskDone.mutate()} aria-label={`Done: ${item.title}`} />
        : item.step
          ? <Checkbox className="mt-0.5" checked={false} onCheckedChange={() => act.doStep(item)} aria-label={`Complete: ${item.title}`} />
          : item.group === "fix" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
            : <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-sm font-medium">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {item.detail && <span>{item.detail}</span>}
          {item.carried && <Badge tone="outline">Carried{item.waited ? ` · ${item.waited} ${item.waited === 1 ? "day" : "days"}` : ""}</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.slot && <>
          <Button size="sm" className={TAP} busy={slot.isPending && slot.variables === "done"} onClick={() => slot.mutate("done")}>Done</Button>
          <Button size="sm" variant="secondary" className={TAP} busy={slot.isPending && slot.variables === "partly"} onClick={() => slot.mutate("partly")}>Partly</Button>
          <Button size="sm" variant="ghost" className={TAP} onClick={() => act.notDone(item)}>Not done</Button>
        </>}
        {item.step && !item.decide && <Button size="sm" variant="secondary" className={TAP} onClick={() => act.doStep(item)}>Complete</Button>}
        {item.task && <Button size="sm" variant="secondary" className={TAP} busy={taskDone.isPending} onClick={() => taskDone.mutate()}>Done</Button>}
        {item.decide && <>
          {item.step && <Button size="sm" variant="secondary" className={TAP} onClick={() => act.doStep(item)}>Complete</Button>}
          <Button size="sm" variant="ghost" className={TAP} onClick={() => act.move(item)}>Reschedule</Button>
          <Button size="sm" variant="ghost" className={TAP} onClick={() => act.drop(item)}>Drop</Button>
          <Button size="sm" variant="ghost" className={TAP} busy={plan.isPending} onClick={() => plan.mutate()}>Add to plan</Button>
        </>}
        {!item.slot && !item.step && !item.task && item.to && <Button size="sm" variant="secondary" className={TAP} asChild><Link to={item.to}>{item.cta ?? "Open"}</Link></Button>}
        {item.acknowledge && <Button size="sm" variant="ghost" className={TAP} busy={letGo.isPending} onClick={() => letGo.mutate()}>{item.group === "fix" ? "Got it" : "Let it go"}</Button>}
      </div>
    </li>
  );
}

/* ---------- P5 Suggested (FR-AC1, FR-AC8) ---------- */

export function SuggestionCard({ s }: { s: Suggestion }) {
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: async (body: { useful?: boolean; dismiss?: boolean }) => api.post(`/playbook/suggestions/${s.id}/`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: playbookQuery.queryKey }),
    onError: (e) => toast.error("Couldn't save that", { description: errorText(e) }),
  });
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{s.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Why: {s.why}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {s.to && <Button size="sm" variant="secondary" className={TAP} asChild><Link to={s.to}>{s.action}</Link></Button>}
            <Button size="icon-sm" variant={s.feedback === "useful" ? "soft" : "ghost"} aria-pressed={s.feedback === "useful"} aria-label="Useful" onClick={() => send.mutate({ useful: true })}><ThumbsUp /></Button>
            <Button size="icon-sm" variant={s.feedback === "not_useful" ? "soft" : "ghost"} aria-pressed={s.feedback === "not_useful"} aria-label="Not useful" onClick={() => send.mutate({ useful: false })}><ThumbsDown /></Button>
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={`Dismiss: ${s.title}`} onClick={() => send.mutate({ dismiss: true })}><X /></Button>
      </div>
    </li>
  );
}

function Section({ id, title, count, right, children }: { id: string; title: ReactNode; count?: number; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 id={id} className="text-sm font-semibold">{title}{count != null && <span className="font-normal text-muted-foreground"> · {count}</span>}</h2>{right}
      </div>
      {children}
    </section>
  );
}

function Fold({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby={id}>
      <h2 id={id}><button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn("flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring", TAP)}>
        <span>{title} <span className="font-normal text-muted-foreground">· {count}</span></span><ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden /></button></h2>
      {open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}

/* ---------- aside: close the day, reminders, notes, trend ---------- */

function CloseCard({ d, onClose, busy }: { d: Day; onClose: () => void; busy: boolean }) {
  return (
    <section className="card p-4" aria-labelledby="close-title">
      <h2 id="close-title" className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />{d.phase_labels.close}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">These tick themselves as the day goes.</p>
      <ul className="mt-3 space-y-2">
        {d.closing.map((x) => {
          const body = <>
            {x.done ? <Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />}
            <span className="min-w-0"><span className={cn("block text-sm", x.done && "text-muted-foreground")}>{x.label}<span className="sr-only">{x.done ? " (done)" : " (not yet)"}</span></span><span className="block text-xs text-muted-foreground">{x.hint}</span></span>
          </>;
          return <li key={x.key}>{x.to && !x.done ? <Link to={x.to} className="flex gap-2 rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">{body}</Link> : <div className="flex gap-2">{body}</div>}</li>;
        })}
      </ul>
      {d.phase !== "close" && d.phase !== "closed" && d.opened_at && <Button size="sm" variant="secondary" className="mt-3 w-full" busy={busy} onClick={onClose}>Close my day</Button>}
    </section>
  );
}

function NotesCard({ d }: { d: Day }) {
  const qc = useQueryClient();
  const records = useQuery(recordsQuery);
  const [kind, setKind] = useState<"task" | "note">("task");
  const [text, setText] = useState("");
  const [client, setClient] = useState("none");
  const saveNote = useMutation({ mutationFn: async (note: string) => api.post("/playbook/note/", { note }), onSuccess: () => qc.invalidateQueries({ queryKey: playbookQuery.queryKey }) });
  const add = useMutation({
    mutationFn: async () => {
      if (kind === "task") { await api.post("/tasks/items/", { title: text, due: "today" }); return null; }
      return (await api.post<{ client: string | null }>("/playbook/note/", { text, client: client === "none" ? undefined : Number(client) })).data;
    },
    onSuccess: (r) => { refreshPlaybook(qc); setText(""); setClient("none"); toast.success(kind === "task" ? "Added to today" : r?.client ? `Noted in ${r.client}'s Client Log` : "Added to your day note"); },
    onError: (e) => toast.error("Couldn't add it", { description: errorText(e) }),
  });
  return (
    <section className="card p-4" aria-labelledby="notes-title">
      <h2 id="notes-title" className="text-sm font-semibold">Notes and quick add</h2>
      <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <Segmented<"task" | "note"> label="What to add" value={kind} onChange={setKind} options={[{ key: "task", label: "Task" }, { key: "note", label: "Note" }]} />
        <Input value={text} maxLength={kind === "task" ? 200 : 1000} onChange={(e) => setText(e.target.value)} placeholder={kind === "task" ? "A task for today" : "A note"} aria-label={kind === "task" ? "New task for today" : "New note"} />
        {kind === "note" && <SimpleSelect value={client} onValueChange={setClient} aria-label="Attach to a client"
          options={[{ value: "none", label: "Just my day note" }, ...(records.data ?? []).map((r) => ({ value: String(r.id), label: r.company }))]} />}
        <Button type="submit" size="sm" variant="secondary" busy={add.isPending} disabled={!text.trim()}><Plus /> Add</Button>
      </form>
      <label htmlFor="day-note" className="label mt-4">Day note</label>
      <Textarea id="day-note" key={d.note} defaultValue={d.note} maxLength={2000} rows={3} placeholder="Anything worth remembering about today" onBlur={(e) => { if (e.target.value.trim() !== d.note.trim()) saveNote.mutate(e.target.value); }} />
    </section>
  );
}

function Trend() {
  const q = useQuery(playbookHistoryQuery);
  const rows = (q.data ?? []).slice(0, 7);
  if (!rows.length) return null;
  return (
    <section className="card p-4" aria-labelledby="trend-title">
      <h2 id="trend-title" className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-muted-foreground" aria-hidden />Recent days</h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.day} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{date(r.day, "short")}</span>
            <Progress value={r.pct ?? 0} tone={toneForRatio((r.pct ?? 0) / 100)} size="sm" label={`${date(r.day, "short")}: ${r.pct ?? 0}%`} className="flex-1" />
            <span className="w-9 text-right text-xs tabular-nums">{r.pct ?? 0}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- FR-DP9: the supervisor's lens ---------- */

function ThanksDialog({ to, onClose }: { to: { work: number; name: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  useEffect(() => { if (to) setMessage(""); }, [to]);
  const send = useMutation({
    mutationFn: async () => api.post("/recognition/thanks/", { work: to!.work, message }),
    onSuccess: () => { ["playbook", "recognition"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); toast.success(`Sent to ${to?.name}`, { description: "It's on the win feed." }); },
  });
  if (!to) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <DialogHeader><DialogTitle>A word for {to.name}</DialogTitle><DialogDescription>It goes on the win feed, for the whole team to see.</DialogDescription></DialogHeader>
          <DialogBody><Field label="Your message" required><Textarea value={message} maxLength={500} className="min-h-16" onChange={(e) => setMessage(e.target.value)} autoFocus required /></Field>
            {send.error && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(send.error)}</p>}</DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={send.isPending} disabled={message.trim().length < 3}>Send</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LensCard({ d }: { d: Day }) {
  const l = d.lens!;
  const [thanking, setThanking] = useState<{ work: number; name: string } | null>(null);
  const tiles: [string, number, string | null][] = [["Approvals due", l.approvals, "/team-board"], ["Didn't close yesterday", l.unclosed, null], ["Overloaded", l.overloaded, "/frameworks"], ["Stuck deals", l.stuck, null]];
  return (
    <Section id="lens-title" title={<span className="inline-flex items-center gap-2"><Users className="size-4 text-muted-foreground" aria-hidden />Team today</span>}>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map(([k, v, to]) => (
          <div key={k} className="bg-card px-4 py-2.5"><dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{to && v > 0 ? <Link to={to} className="underline decoration-dotted underline-offset-4">{v}</Link> : v}</dd></div>
        ))}
      </dl>
      {l.people.length > 0 && <div role="region" aria-label="Team today" tabIndex={0} className="overflow-x-auto border-t border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <table className="w-full min-w-[30rem] text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-1.5 font-semibold">Person</th><th className="px-4 py-1.5 font-semibold">Today</th><th className="px-4 py-1.5 font-semibold">Yesterday</th><th className="px-4 py-1.5 text-right font-semibold">Stuck</th></tr></thead>
          <tbody>{l.people.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2"><Link to={`/my-day?work=${p.work}`} className="font-medium hover:underline">{p.name}</Link>{p.overloaded && <Badge tone="warning" className="ml-2">Overloaded</Badge>}</td>
              <td className="px-4 py-2">{p.started ? <div className="flex min-w-28 items-center gap-2"><Progress value={p.pct ?? 0} size="sm" tone={toneForRatio((p.pct ?? 0) / 100)} label={`${p.name}: ${p.pct ?? 0}% of today`} className="flex-1" />
                <span className="w-9 text-right text-xs tabular-nums">{p.pct ?? 0}%</span></div> : <span className="text-xs text-muted-foreground">Not started</span>}{p.closed && <span className="ml-1 text-xs text-muted-foreground">Closed</span>}</td>
              <td className="px-4 py-2 text-xs text-muted-foreground">{p.yesterday_closed ? "Closed" : "Not closed"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{p.stuck}</td>
            </tr>))}</tbody>
        </table>
      </div>}
      {l.prompts.length > 0 && <ul className="divide-y divide-border border-t border-border text-sm">{l.prompts.map((p) => (
        <li key={p.owner} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2"><Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden /><span className="min-w-0 flex-1 basis-48">{p.text}</span>
          <Button size="sm" variant="secondary" className={TAP} onClick={() => setThanking({ work: p.work, name: p.name })}>Send a word</Button></li>))}</ul>}
      <ThanksDialog to={thanking} onClose={() => setThanking(null)} />
    </Section>
  );
}

/* ---------- the page ---------- */

/** Home: the Daily Playbook (SRS v0.5 §5.8). One primary action at any time; do the work here or one tap away; the ring follows. */
export default function Playbook() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const q = useQuery(playbookQuery);
  const streak = useQuery(recognitionQuery(null)).data?.streaks?.days.current ?? 0;
  const { set } = useDay();
  const [doing, setDoing] = useState<PlaybookItem | null>(null);
  const [notDone, setNotDone] = useState<PlaybookItem | null>(null);
  const [moving, setMoving] = useState<PlaybookItem | null>(null);
  const [dropping, setDropping] = useState<PlaybookItem | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const day = useMutation({
    mutationFn: async (action: "start" | "close" | "reopen") => (await api.post<Day>("/playbook/today/", { action })).data,
    onSuccess: (d, action) => { set(d); if (action === "close") toast.success("Day closed", { action: { label: "Undo", onClick: () => day.mutate("reopen") } }); },
    onError: (e) => toast.error("Couldn't do that", { description: errorText(e) }),
  });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const started = !!d.opened_at;
  const act: Act = { doStep: setDoing, notDone: setNotDone, move: setMoving, drop: setDropping };
  const primary = () => {
    const p = d.primary;
    if (!p) return;
    if (p.kind === "open") return day.mutate("start");
    if (p.kind === "close") return day.mutate("close");
    const it = [...d.do_now, ...d.up_next].find((x) => x.key === p.item);
    if (!it) return;
    if (it.step) return setDoing(it);
    if (it.group === "fix" && it.to) return navigate(it.to);
    setFocus(it.key);
    document.getElementById(`item-${it.key.replace(/[^a-z0-9]/gi, "-")}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const c = d.counts;
  const parts = [c.fix && `${c.fix} to fix`, c.planned && `${c.planned} planned ${c.planned === 1 ? "hour" : "hours"}`, c.step && `${c.step} ${c.step === 1 ? "step" : "steps"}`, c.task && `${c.task} ${c.task === 1 ? "task" : "tasks"}`, c.carry && `${c.carry} carried over`].filter(Boolean);
  const pct = d.ring.pct ?? 0;
  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{hello}, {(user?.name || "").split(" ")[0] || "there"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{date(d.day, "weekday")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3"><Phases d={d} />{streak >= 2 && <Badge tone="outline"><Flame aria-hidden /><span className="tabular-nums">{streak}-day streak</span></Badge>}{started && <Stopwatch seconds={d.elapsed_seconds} running={d.running} />}</div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,720px)_20rem]">
        <div className="space-y-4">
          {/* FR-DP1, FR-DP4: the day ring and the one primary action */}
          <section className="card flex flex-wrap items-center gap-4 p-5" aria-label="Your day">
            <ProgressRing value={pct} size={84} stroke={8} tone={pct >= 100 ? "success" : "primary"} label={`Today ${pct}% done`}>
              <span className="text-lg font-semibold tabular-nums">{d.ring.pct == null ? "—" : `${pct}%`}</span>
            </ProgressRing>
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-base font-medium">{d.ring.message}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {d.closed_at ? `Closed at ${new Date(d.closed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`
                  : !started ? (parts.length ? `Today: ${parts.join(", ")}.` : "Nothing on the list yet.")
                    : d.do_now.length ? `${d.do_now.length + d.up_next.length} still to do.` : "Nothing left on the list."}
              </p>
            </div>
            {d.primary && <Button size="lg" className={cn("w-full sm:w-auto", TAP)} busy={day.isPending} onClick={primary}>{d.primary.label}</Button>}
            {d.closed_at && <Button variant="ghost" className={TAP} busy={day.isPending} onClick={() => day.mutate("reopen")}>Reopen my day</Button>}
          </section>

          {started && <>
            {d.do_now.length > 0 ? (
              <Section id="do-now" title={d.phase === "morning" ? "Fix these first" : "Do now"} count={d.do_now.length}>
                <ul className="divide-y divide-border">{d.do_now.map((i) => <ItemCard key={i.key} item={i} act={act} highlight={focus === i.key} />)}</ul>
              </Section>
            ) : !d.closed_at && !d.done.length && (
              <div className="card"><EmptyState compact icon={<CalendarClock />} title="Nothing on your list today"
                action={d.has_log ? <Button variant="secondary" asChild><Link to="/my-day?tab=plan">Plan your week</Link></Button> : undefined}>
                Approved plan hours, framework steps and tasks due today show up here.
              </EmptyState></div>
            )}
            {d.light && !d.closed_at && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
                <Lightbulb className="size-4 shrink-0 text-accent-text" aria-hidden /><p className="min-w-0 flex-1 basis-48">{d.light.message}</p>
                <Button size="sm" variant="secondary" className={TAP} asChild><Link to={d.light.to}>{d.light.action}</Link></Button>
              </div>
            )}
            <Fold id="up-next" title="Up next" count={d.up_next.length}><ul className="divide-y divide-border">{d.up_next.map((i) => <ItemCard key={i.key} item={i} act={act} highlight={focus === i.key} />)}</ul></Fold>
            {d.suggested.length > 0 && !d.closed_at && (
              <Section id="suggested" title="Suggested" right={<Badge tone="outline"><Sparkles aria-hidden />AI Coach</Badge>}>
                <ul className="divide-y divide-border">{d.suggested.map((s) => <SuggestionCard key={s.id} s={s} />)}</ul>
              </Section>
            )}
            <Fold id="done-today" title="Done today" count={d.done.length}>
              <ul className="divide-y divide-border">{d.done.map((i) => (
                <li key={i.key} className="flex items-start gap-3 px-4 py-2.5 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
                  <div className="min-w-0"><div>{i.title}</div><div className="text-xs text-muted-foreground">{i.slot?.status === "not_done" ? `Not done: ${i.slot.reason}` : i.slot?.status === "partly" ? "Partly done" : i.detail}</div></div></li>
              ))}</ul>
            </Fold>
          </>}
          {d.lens && <MorningBrief />}
          {d.lens && <LensCard d={d} />}
        </div>

        <aside className="space-y-4">
          {started && <CloseCard d={d} busy={day.isPending} onClose={() => day.mutate("close")} />}
          {d.reminders.length > 0 && (
            <section className="card p-4" aria-labelledby="reminders-title">
              <h2 id="reminders-title" className="flex items-center gap-2 text-sm font-semibold"><BellRing className="size-4 text-muted-foreground" aria-hidden />Reminders</h2>
              <ul className="mt-2 space-y-1.5 text-sm">{d.reminders.map((r) => <li key={r.key}><Link to={r.to} className="hover:underline">{r.title}</Link></li>)}</ul>
            </section>
          )}
          {started && <NotesCard d={d} />}
          <Trend />
        </aside>
      </div>

      <CompleteStepDialog step={doing?.step ?? null} onClose={() => setDoing(null)} />
      <NotDoneDialog item={notDone} onClose={() => setNotDone(null)} />
      <RescheduleDialog item={moving} today={d.day} onClose={() => setMoving(null)} />
      <DropDialog item={dropping} onClose={() => setDropping(null)} />
    </>
  );
}
