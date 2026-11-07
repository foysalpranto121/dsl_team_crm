import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Clock, Copy, Eraser, LayoutTemplate, Lock, MoreHorizontal, Send, Trash2, Undo2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { Slot, Task } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StepTracker, type StepState } from "@/components/data/steps";
import { ErrorState } from "@/components/data/states";
import { Alert } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TimeByType, type SlotTask } from "../log/parts";
import { SLOTS, fmt, hoursText, num, ptsText, typeColours } from "../log/util";
import { STATUS_PILL, pad, type PlanState, type PlanTemplate, type PlanWeek } from "./rules";

/**
 * My Day → Plan (SRS v0.5 FR-P1–P6, §6): a week of hours as a grid. Select one hour, or a range (shift-click), and set the
 * task; copy a day, last week or a template; then submit. The supervisor approves all of it, part of it, or edits and
 * approves; approved hours are binding. A day's plan closes at the end of the previous working day (by team policy).
 */

const STATE: Record<Exclude<PlanState, null> | "draft", { label: string; icon: typeof Check; cls: string }> = {
  draft: { label: "Draft", icon: Clock, cls: "border-border bg-card" },
  submitted: { label: "Waiting for approval", icon: Clock, cls: "border-info/40 bg-info-soft" },
  approved: { label: "Approved", icon: Check, cls: "border-success/40 bg-success-soft" },
  rejected: { label: "Rejected", icon: X, cls: "border-danger/50 bg-danger-soft" },
};
const key = (di: number, hi: number) => `${di}:${hi}`;

function steps(w: PlanWeek): { label: string; state: StepState }[] {
  const s = w.status;
  const submitted = s === "submitted", decided = s === "approved" || s === "partial";
  return [
    { label: "Draft", state: !s || s === "draft" ? "current" : "done" },
    { label: "Submitted", state: submitted ? "current" : decided || s === "rejected" ? "done" : "upcoming" },
    { label: s === "partial" ? "Partly approved" : s === "rejected" ? "Rejected" : "Approved", state: s === "rejected" ? "failed" : decided ? (w.phase ? "done" : "current") : "upcoming" },
    { label: "In execution", state: w.phase === "execution" ? "current" : w.phase === "closed" ? "done" : "upcoming" },
    { label: "Closed", state: w.phase === "closed" ? "done" : "upcoming" },
  ];
}

export function PlanView({ work, day, go }: { work: { id: number }; day: string; go: (next: { day?: string; tab?: string }) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const q = useQuery({ queryKey: ["plan-week", work.id, day], queryFn: async () => (await api.get<PlanWeek>(`/team/plans/week/?work=${work.id}&week=${day}`)).data });
  const templates = useQuery({ queryKey: ["plan-templates"], queryFn: async () => (await api.get<PlanTemplate[]>("/team/plans/templates/")).data });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<[number, number] | null>(null);
  const [mobileDay, setMobileDay] = useState(0);
  const [saveAs, setSaveAs] = useState(false);
  const [busy, setBusy] = useState(false);
  const w = q.data;

  const colours = useMemo(() => typeColours(tasks.data ?? []), [tasks.data]);
  const taskOf = (id: Slot): SlotTask | null => {
    const x = id != null ? tasks.data?.find((t) => t.id === id) : undefined;
    return x ? { id: x.id, name: x.name, type: x.type || "Other", points: +x.points, colour: colours.get(x.type || "Other")! } : null;
  };
  const options = useMemo<ComboOption[]>(() => {
    const chosen = new Set(w?.choices ?? []);
    return (tasks.data ?? []).filter((x) => chosen.has(x.id) || (isAdmin && x.active)).map((x) => ({ value: String(x.id), label: x.name, hint: ptsText(+x.points),
      group: chosen.has(x.id) ? x.type || "Tasks" : "Other tasks (admins only)", keywords: [x.type],
      icon: <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colours.get(x.type || "Other") }} aria-hidden /> }));
  }, [w?.choices, tasks.data, colours, isAdmin]);

  const refresh = () => ["plan-week", "plan-history", "plans-mine", "board", "entries", "huddle"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: errorText(e) });
  const act = useMutation({
    mutationFn: async (action: "submit" | "withdraw") => (await api.post<PlanWeek & { hours: number }>("/team/plans/action/", { work: work.id, week: day, action })).data,
    onSuccess: (r, action) => { refresh(); toast.success(action === "submit" ? `${hoursText(r.hours)} sent for approval` : "Plan taken back",
      { description: action === "submit" ? "Your supervisor approves them on the Team Board." : "Those hours are drafts again." }); },
    onError: fail("Couldn't change the plan"),
  });
  const copy = useMutation({
    mutationFn: async (body: { source: "last_week" | "day" | "template"; day?: string; template?: number }) =>
      (await api.post<PlanWeek & { filled: number }>("/team/plans/copy/", { work: work.id, week: day, ...body })).data,
    onSuccess: (r) => { refresh(); toast[r.filled ? "success" : "info"](r.filled ? `${r.filled} ${r.filled === 1 ? "day" : "days"} filled` : "Nothing to fill",
      { description: r.filled ? "Only empty days that are still open were filled." : "Empty days that are still open get filled; planned days are never overwritten." }); },
    onError: fail("Couldn't copy"),
  });
  const goals = useMutation({ mutationFn: async (text: string) => api.patch("/team/plans/week/", { work: work.id, week: day, goals: text }), onSuccess: refresh, onError: fail("Couldn't save the goals") });
  const delTemplate = useMutation({ mutationFn: async (id: number) => api.delete(`/team/plans/templates/${id}/`), onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-templates"] }) });

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!w || !tasks.data) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-[30rem] w-full" /></div>;

  const editableCell = (di: number, hi: number) => {
    const d = w.days[di];
    const st = d.states[hi];
    return w.can.plan && d.editable && (isAdmin || st == null || st === "rejected");
  };
  const click = (di: number, hi: number, e: React.MouseEvent) => {
    if (!editableCell(di, hi)) return;
    const k = key(di, hi);
    if (e.shiftKey && anchor.current) {
      const [a0, b0] = anchor.current, next = new Set<string>();
      for (let x = Math.min(a0, di); x <= Math.max(a0, di); x++) for (let y = Math.min(b0, hi); y <= Math.max(b0, hi); y++) if (editableCell(x, y)) next.add(key(x, y));
      setSel(next);
      return;
    }
    anchor.current = [di, hi];
    if (e.ctrlKey || e.metaKey) { const next = new Set(sel); if (next.has(k)) next.delete(k); else next.add(k); setSel(next); return; }
    setSel(sel.size === 1 && sel.has(k) ? new Set() : new Set([k]));
  };
  const apply = async (task: number | null) => {
    if (!w.plan_sheet) return;
    const byDay = new Map<number, number[]>();
    sel.forEach((k) => { const [di, hi] = k.split(":").map(Number); byDay.set(di, [...(byDay.get(di) ?? []), hi]); });
    setBusy(true);
    try {
      for (const [di, his] of byDay) {
        const d = w.days[di];
        const slots = pad(d.slots, null);
        his.forEach((hi) => { slots[hi] = task; });
        await api.put(`/team/sheets/${w.plan_sheet}/entries/${d.day}/`, { slots, remarks: d.note });
      }
      setSel(new Set());
    } catch (e) {
      toast.error("Couldn't change the plan", { description: errorText(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const cell = (di: number, hi: number, wide = false) => {
    const d = w.days[di], t = taskOf(d.slots[hi] ?? null), st = d.states[hi], can = editableCell(di, hi), on = sel.has(key(di, hi));
    const look = STATE[st ?? "draft"];
    const label = `${fmt(d.day, { weekday: "long", day: "numeric", month: "long" })}, hour ${hi + 1}: ${t ? `${t.name}, ${look.label.toLowerCase()}` : "nothing planned"}`;
    return (
      <button type="button" onClick={(e) => click(di, hi, e)} aria-pressed={can ? on : undefined} aria-label={label} disabled={!can && !t}
        title={t ? `${t.name} · ${look.label}` : undefined}
        className={cn("group relative flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-xs transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
          t ? look.cls : can ? "border-dashed border-border bg-transparent hover:border-primary/50 hover:bg-primary-soft/40" : "border-transparent bg-muted/40",
          on && "ring-2 ring-primary ring-offset-1 ring-offset-card", !can && t && "cursor-default", wide && "h-11 text-sm")}>
        {t ? (
          <>
            <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: t.colour }} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{t.name}</span>
            {st && <look.icon className={cn("size-3.5 shrink-0", st === "approved" ? "text-success-text" : st === "rejected" ? "text-danger-text" : "text-info-text")} aria-hidden />}
          </>
        ) : can ? <span className="text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100">+ Plan</span> : null}
      </button>
    );
  };

  const dayMenu = (di: number) => {
    const d = w.days[di];
    if (!w.can.plan || d.hours === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${fmt(d.day, { weekday: "long" })}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => copy.mutate({ source: "day", day: d.day })}><Copy /> Copy to the empty days</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const dayHead = (di: number) => {
    const d = w.days[di];
    return (
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className={cn("text-xs font-semibold uppercase tracking-wide", d.day === w.today ? "text-primary-text" : "text-muted-foreground")}>{fmt(d.day, { weekday: "short" })} {fmt(d.day, { day: "numeric" })}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {!d.editable && <Tip content={d.blocked ?? "Closed"}><Lock className="size-3" aria-label={d.blocked ?? "Closed"} /></Tip>}
            {d.hours ? hoursText(d.hours) : d.weekend ? "Weekend" : "—"}
          </div>
        </div>
        {dayMenu(di)}
      </div>
    );
  };

  const rejected = w.counts.rejected;
  const typeRows = (() => {
    const m = new Map<string, number>();
    w.days.forEach((d) => d.slots.forEach((s) => { const t = taskOf(s); if (t) m.set(t.type, (m.get(t.type) ?? 0) + 1); }));
    return [...m].map(([type, hours]) => ({ type, hours, colour: colours.get(type)! })).sort((a, b) => b.hours - a.hours);
  })();
  const range = `${fmt(w.week.start, { day: "numeric", month: "short" })} – ${fmt(w.week.end, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-5">
      <section className="card p-5" aria-labelledby="plan-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="plan-title" className="text-lg font-semibold">Week {w.week.no} plan</h2>
            <p className="text-sm text-muted-foreground">{range}{w.plan?.submitted_at && ` · sent ${fmt(w.plan.submitted_at.slice(0, 10), { day: "numeric", month: "short" })}`}
              {w.plan?.reviewed_by && ` · last decided by ${w.plan.reviewed_by}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {w.status ? <StatusPill status={STATUS_PILL[w.status]}>{w.status_label}</StatusPill> : <Badge tone="outline">Not planned yet</Badge>}
            {w.phase && <Badge tone={w.phase === "execution" ? "primary" : "neutral"}>{w.phase === "execution" ? "In execution" : "Closed"}</Badge>}
          </div>
        </div>
        <StepTracker className="mt-5" steps={steps(w)} />
        {rejected > 0 && (
          <Alert tone="red" className="mt-4">
            Your supervisor sent back {hoursText(rejected)}{w.plan?.review_note ? `: “${w.plan.review_note}”` : "."} Change {rejected === 1 ? "it" : "them"} and submit again.
          </Alert>
        )}
        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label="Goals for the week" hint="One or two lines your supervisor sees with the plan.">
            <Textarea key={`${w.work}-${w.week.start}-${w.plan?.goals ?? ""}`} defaultValue={w.plan?.goals ?? ""} rows={2} maxLength={1000} disabled={!w.can.plan}
              placeholder="e.g. Book 3 demos and send 2 proposals" onBlur={(e) => { if (e.target.value.trim() !== (w.plan?.goals ?? "").trim()) goals.mutate(e.target.value); }} />
          </Field>
          {w.can.plan && (
            <div className="flex flex-wrap gap-2 md:justify-end">
              {w.can.copy_last_week && <Button variant="secondary" busy={copy.isPending} onClick={() => copy.mutate({ source: "last_week" })}><Copy /> Copy last week</Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary"><LayoutTemplate /> Templates</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Fill empty days from</DropdownMenuLabel>
                  {(templates.data ?? []).length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No templates yet.</div>}
                  {(templates.data ?? []).map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => copy.mutate({ source: "template", template: t.id })}>
                      <LayoutTemplate /><span className="flex-1 truncate">{t.name}</span><span className="text-xs text-muted-foreground">{hoursText(t.hours)}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={w.totals.hours === 0} onSelect={() => setSaveAs(true)}><BookmarkPlus /> Save this week as a template…</DropdownMenuItem>
                  {(templates.data ?? []).map((t) => (
                    <DropdownMenuItem key={`d${t.id}`} tone="danger" onSelect={() => delTemplate.mutate(t.id)}><Trash2 /> Delete “{t.name}”</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {w.can.withdraw && <Button variant="secondary" busy={act.isPending && act.variables === "withdraw"} onClick={() => act.mutate("withdraw")}><Undo2 /> Withdraw</Button>}
              <Button busy={act.isPending && act.variables === "submit"} disabled={!w.can.submit} onClick={() => act.mutate("submit")}>
                <Send /> {w.submittable ? `Submit ${hoursText(w.submittable)}` : "Submit for approval"}</Button>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="card overflow-hidden" aria-label="Planned hours">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            {sel.size > 0 ? (
              <div className="flex w-full flex-wrap items-center gap-2" role="toolbar" aria-label="Selected hours">
                <span className="text-sm font-medium">{hoursText(sel.size)} selected</span>
                <div className="w-64 max-w-full"><Combobox options={options} value={null} onChange={(v) => v && apply(Number(v))} placeholder="Set the task…"
                  searchPlaceholder="Search tasks…" aria-label="Task for the selected hours" disabled={busy} /></div>
                <Button variant="secondary" size="sm" busy={busy} onClick={() => apply(null)}><Eraser /> Clear</Button>
                <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>Done</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{w.can.plan ? "Click an hour to plan it. Shift-click to select a range; Ctrl-click to add hours." : `${w.person}'s plan (read only).`}</p>
                <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
                  {(["draft", "submitted", "approved", "rejected"] as const).map((k) => { const L = STATE[k]; return (
                    <li key={k} className="inline-flex items-center gap-1.5"><span className={cn("grid size-4 place-items-center rounded border", L.cls)}><L.icon className="size-2.5" aria-hidden /></span>{L.label}</li>); })}
                </ul>
              </>
            )}
          </div>
          {/* Desktop and tablet: the whole week */}
          <div className="hidden overflow-x-auto p-3 md:block">
            <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-1" aria-label={`Week ${w.week.no} plan`}>
              <thead>
                <tr>
                  <th className="w-12" scope="col"><span className="sr-only">Hour</span></th>
                  {w.days.map((d, di) => <th key={d.day} scope="col" className="px-1 pb-1 text-left font-normal">{dayHead(di)}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: SLOTS }, (_, hi) => (
                  <tr key={hi}>
                    <th scope="row" className="pr-1 text-right text-xs font-medium tabular-nums text-muted-foreground">H-{hi + 1}</th>
                    {w.days.map((d, di) => <td key={d.day} className={cn(d.weekend && "bg-muted/30")}>{cell(di, hi)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: one day at a time */}
          <div className="p-3 md:hidden">
            <div className="mb-3 grid grid-cols-7 gap-1" role="group" aria-label="Day">
              {w.days.map((d, di) => (
                <button key={d.day} type="button" aria-pressed={mobileDay === di} onClick={() => { setMobileDay(di); setSel(new Set()); }}
                  className={cn("rounded-lg border px-0.5 py-1.5 text-center text-[11px]", mobileDay === di ? "border-primary bg-primary-soft font-semibold text-primary-text" : "border-border")}>
                  <div>{fmt(d.day, { weekday: "short" })}</div><div className="tabular-nums">{d.hours || "—"}</div>
                </button>
              ))}
            </div>
            <div className="mb-2">{dayHead(mobileDay)}</div>
            <ol className="space-y-1.5">
              {Array.from({ length: SLOTS }, (_, hi) => (
                <li key={hi} className="flex items-center gap-2"><span className="w-9 text-right text-xs tabular-nums text-muted-foreground">H-{hi + 1}</span>
                  <div className="min-w-0 flex-1">{cell(mobileDay, hi, true)}</div></li>
              ))}
            </ol>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5" aria-labelledby="plan-sum">
            <h2 id="plan-sum" className="text-sm font-semibold">This week's plan</h2>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">{num.format(w.totals.hours)} h</span>
              {w.target_hours > 0 && <span className="text-sm text-muted-foreground">of {num.format(w.target_hours)} h target</span>}
            </div>
            {w.target_hours > 0 && <Progress value={Math.min(w.totals.hours, w.target_hours)} max={w.target_hours} size="sm" label="Planned hours against the weekly target" className="mt-3" />}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {([["Approved", w.counts.approved], ["Waiting", w.counts.submitted], ["Draft", w.counts.draft], ["Rejected", w.counts.rejected]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
            {w.week.current && <p className="mt-3 text-xs text-muted-foreground">Logged so far: {hoursText(w.totals.output)} counted of {hoursText(w.totals.logged)} logged.{" "}
              <button type="button" className="font-semibold text-primary-text underline" onClick={() => go({ tab: "day" })}>Log today</button></p>}
            <p className="mt-3 text-xs text-muted-foreground">{w.cutoff === "previous_day" ? "Each day's plan closes at the end of the working day before it." : "Each day can be planned up to the day itself."}</p>
          </section>
          <TimeByType rows={typeRows} />
        </aside>
      </div>

      <SaveTemplate open={saveAs} onOpenChange={setSaveAs} work={work.id} day={day} />
    </div>
  );
}

function SaveTemplate({ open, onOpenChange, work, day }: { open: boolean; onOpenChange: (o: boolean) => void; work: number; day: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: async () => (await api.post("/team/plans/templates/", { work, week: day, name })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plan-templates"] }); onOpenChange(false); setName(""); toast.success("Template saved", { description: "Use it from Templates on any week." }); },
    onError: (e) => toast.error("Couldn't save the template", { description: errorText(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
          <DialogHeader><DialogTitle>Save as a template</DialogTitle><DialogDescription>The hours of this week, by weekday, to reuse on any week.</DialogDescription></DialogHeader>
          <DialogBody><Field label="Name" required><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard sales week" required /></Field></DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!name.trim()}>Save template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
