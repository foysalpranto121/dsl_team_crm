import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ChevronLeft, ChevronRight, Flag, FlagOff, LayoutGrid, PencilLine, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import type { Slot, Task } from "@/api/types";
import { Avatar } from "@/components/Brand";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form-controls";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { TimeByType } from "../log/parts";
import { SLOTS, addDays, dow, fmt, hoursText, num, ptsText, typeColours, weekStartOf } from "../log/util";
import { STATUS_PILL, type WeekStatus } from "../myday/rules";

/**
 * Team Board (SRS v0.5 FR-P5, FR-P2, D1, §6): everyone's week, what waits for a decision, and planned coverage by kind of
 * work. Approve all of a plan, part of it, or edit an hour and approve it; reject with a comment; review deviations and
 * unplanned hours; flag any logged hour. Bulk approval across people. Nobody decides on their own hours.
 */

type PlanCell = { task: Slot; state: "draft" | "submitted" | "approved" | "rejected" } | null;
type LogCell = { task: Slot; status: string | null; review: string | null; reason: string; unplanned: boolean; planned: Slot } | null;
interface Member {
  work: number; person: string; photo: string | null; role: string | null; own: boolean; status: WeekStatus; status_label: string; goals: string; review_note: string;
  target_hours: number; planned_hours: number; approved_hours: number; days: { day: string; plan: PlanCell[]; log: LogCell[] }[];
  pending: { plan: number; deviation: number; unplanned: number };
}
interface Board {
  week: { start: string; end: string; no: number; current: boolean; past: boolean }; today: string; members: Member[];
  coverage: { type: string; hours: number }[]; pending: { plan: number; deviation: number; unplanned: number }; unplanned_mode: "provisional" | "strict";
}
type Item = { work: number; day: string; slot: number; kind: "plan" | "log" };

const SEG: Record<string, string> = { approved: "bg-success", submitted: "bg-info", rejected: "bg-danger", draft: "bg-subtle-foreground/50" };

function MiniWeek({ m }: { m: Member }) {
  return (
    <div className="grid grid-cols-7 gap-1" aria-hidden>
      {m.days.map((d) => (
        <div key={d.day} className="flex flex-col gap-px" title={fmt(d.day, { weekday: "short", day: "numeric" })}>
          {Array.from({ length: SLOTS }, (_, i) => <span key={i} className={cn("h-1 w-full rounded-full", d.plan[i] ? SEG[d.plan[i]!.state] : "bg-muted")} />)}
        </div>
      ))}
    </div>
  );
}

function useDecide(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { items: Item[]; decision: "approve" | "reject" | "flag" | "unflag"; note?: string; task?: number }) =>
      (await api.post<{ changed: number }>("/team/board/decide/", body)).data,
    onSuccess: (r, v) => {
      ["board", "plans-mine", "plan-week", "entries", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const verb = { approve: "approved", reject: "sent back", flag: "flagged", unflag: "unflagged" }[v.decision];
      toast.success(r.changed ? `${hoursText(r.changed)} ${verb}` : "Nothing changed", { description: r.changed ? undefined : "Only hours waiting for a decision can be approved or rejected." });
      onDone?.();
    },
    onError: (e) => toast.error("Couldn't save the decision", { description: errorText(e) }),
  });
}

function NoteDialog({ open, title, description, cta, tone, onClose, onSubmit, busy }: {
  open: boolean; title: string; description: string; cta: string; tone?: "danger"; onClose: () => void; onSubmit: (note: string) => void; busy: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setNote(""); } }}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) onSubmit(note.trim()); }}>
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
          <DialogBody><Field label="Comment" required hint="The person sees it with their plan."><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} required /></Field></DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} busy={busy} disabled={note.trim().length < 3}>{cta}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Review({ m, tasks, open, onClose, strict }: { m: Member | null; tasks: Task[]; open: boolean; onClose: () => void; strict: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"reject" | "edit" | "flag" | null>(null);
  const [flagItem, setFlagItem] = useState<Item | null>(null);
  const [show, setShow] = useState<"waiting" | "all">("waiting");
  const decide = useDecide(() => { setSel(new Set()); setDialog(null); setFlagItem(null); });
  const colours = useMemo(() => typeColours(tasks), [tasks]);
  const name = (id: Slot) => tasks.find((t) => t.id === id)?.name ?? "—";
  const colour = (id: Slot) => colours.get(tasks.find((t) => t.id === id)?.type || "Other");
  if (!m) return null;
  const waiting = m.days.flatMap((d) => d.plan.map((c, i) => (c?.state === "submitted" ? `${d.day}:${i}` : null))).filter(Boolean) as string[];
  const items = (keys: Iterable<string>, kind: "plan" | "log"): Item[] => [...keys].map((k) => { const [day, i] = k.split(":"); return { work: m.work, day, slot: +i, kind }; });
  const logRows = m.days.flatMap((d) => d.log.map((c, i) => (c ? { day: d.day, i, c } : null)).filter(Boolean) as { day: string; i: number; c: NonNullable<LogCell> }[])
    .filter((r) => show === "all" || r.c.review === "pending" || r.c.review === "flagged");

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { onClose(); setSel(new Set()); } }}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Avatar name={m.person} src={m.photo} size="sm" />{m.person}</SheetTitle>
          <SheetDescription>{m.role ?? "No job role"} · planned {hoursText(m.planned_hours)} of {hoursText(m.target_hours)} · {hoursText(m.approved_hours)} approved</SheetDescription>
          {m.goals && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm"><span className="font-medium">Goals: </span>{m.goals}</p>}
        </SheetHeader>
        <SheetBody className="space-y-6">
          {m.own && <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-text">This is your own week. Another supervisor or an admin decides on it.</p>}
          <section aria-labelledby="rv-plan">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 id="rv-plan" className="text-sm font-semibold">Planned hours</h3>
              {!m.own && waiting.length > 0 && (
                <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Decide on the selected hours">
                  <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === waiting.length ? new Set() : new Set(waiting))}>{sel.size === waiting.length ? "Clear selection" : `Select all waiting (${waiting.length})`}</Button>
                  <Button size="sm" disabled={!sel.size} busy={decide.isPending} onClick={() => decide.mutate({ items: items(sel, "plan"), decision: "approve" })}><Check /> Approve {sel.size || ""}</Button>
                  <Button size="sm" variant="secondary" disabled={sel.size !== 1} onClick={() => setDialog("edit")}><PencilLine /> Edit &amp; approve</Button>
                  <Button size="sm" variant="danger-ghost" disabled={!sel.size} onClick={() => setDialog("reject")}><X /> Reject…</Button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-xs" aria-label={`${m.person}'s planned hours`}>
                <thead><tr><th className="w-10"><span className="sr-only">Hour</span></th>{m.days.map((d) => <th key={d.day} scope="col" className="text-left font-medium text-muted-foreground">{fmt(d.day, { weekday: "short", day: "numeric" })}</th>)}</tr></thead>
                <tbody>
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <tr key={i}>
                      <th scope="row" className="text-right font-medium tabular-nums text-muted-foreground">H-{i + 1}</th>
                      {m.days.map((d) => {
                        const c = d.plan[i], k = `${d.day}:${i}`, can = !m.own && c?.state === "submitted", on = sel.has(k);
                        return (
                          <td key={d.day}>
                            {c ? (
                              <button type="button" disabled={!can} aria-pressed={can ? on : undefined} onClick={() => { const n = new Set(sel); if (on) n.delete(k); else n.add(k); setSel(n); }}
                                aria-label={`${fmt(d.day, { weekday: "long" })} hour ${i + 1}: ${name(c.task)}, ${c.state}`}
                                className={cn("flex h-8 w-full items-center gap-1 rounded border px-1.5 text-left", c.state === "approved" ? "border-success/40 bg-success-soft" : c.state === "submitted" ? "border-info/40 bg-info-soft" : c.state === "rejected" ? "border-danger/50 bg-danger-soft" : "border-border bg-card",
                                  on && "ring-2 ring-primary", !can && "cursor-default")}>
                                <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: colour(c.task) }} aria-hidden />
                                <span className="truncate">{name(c.task)}</span>
                                {c.state === "approved" && <Check className="ml-auto size-3 shrink-0 text-success-text" aria-hidden />}
                                {c.state === "rejected" && <X className="ml-auto size-3 shrink-0 text-danger-text" aria-hidden />}
                              </button>
                            ) : <span className="block h-8 rounded bg-muted/40" />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="rv-log">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 id="rv-log" className="text-sm font-semibold">Logged hours</h3>
              <Segmented label="Show" value={show} onChange={setShow} options={[{ key: "waiting", label: "Needs a decision" }, { key: "all", label: "All logged hours" }]} />
            </div>
            {logRows.length === 0 ? <p className="text-sm text-muted-foreground">{show === "waiting" ? "No deviations or unplanned hours wait for a decision." : "Nothing logged this week."}</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {logRows.map(({ day, i, c }) => {
                  const it: Item = { work: m.work, day, slot: i, kind: "log" };
                  const deviation = c.planned != null && c.task !== c.planned;
                  return (
                    <li key={`${day}:${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
                      <div className="w-24 shrink-0 text-xs text-muted-foreground">{fmt(day, { weekday: "short", day: "numeric" })} · H-{i + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.status === "not_done" ? `Not done: ${name(c.planned)}` : name(c.task)}</div>
                        <div className="text-xs text-muted-foreground">
                          {deviation ? `Instead of the plan: ${name(c.planned)}` : c.unplanned ? "Unplanned" : "As planned"}{c.reason && ` · “${c.reason}”`}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.review === "pending" && <StatusPill status="info">Waiting</StatusPill>}
                        {c.review === "flagged" && <StatusPill status="warning">Flagged</StatusPill>}
                        {c.review === "approved" && <StatusPill status="good">Approved</StatusPill>}
                        {c.review === "rejected" && <StatusPill status="danger">Not approved</StatusPill>}
                        {!m.own && c.review === "pending" && <>
                          <Button size="sm" busy={decide.isPending} onClick={() => decide.mutate({ items: [it], decision: "approve" })}><Check /> Approve</Button>
                          <Button size="sm" variant="danger-ghost" onClick={() => { setFlagItem(it); setDialog("reject"); }}><X /> Reject</Button>
                        </>}
                        {!m.own && c.task != null && c.review !== "pending" && c.review !== "flagged" && c.status !== "not_done" && (
                          <Button size="sm" variant="ghost" onClick={() => { setFlagItem(it); setDialog("flag"); }}><Flag /> Flag</Button>)}
                        {!m.own && c.review === "flagged" && <Button size="sm" variant="ghost" busy={decide.isPending} onClick={() => decide.mutate({ items: [it], decision: "unflag" })}><FlagOff /> Unflag</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{strict ? "Strict mode: unplanned hours count once approved." : "Unplanned hours count for now; flag one to take its points away."} Deviations count once approved.</p>
          </section>
        </SheetBody>

        <NoteDialog open={dialog === "reject"} title="Send back with a comment" tone="danger" cta="Reject" busy={decide.isPending}
          description={flagItem ? "This logged hour stays at zero." : `${hoursText(sel.size)} go back to ${m.person} as rejected. They change them and submit again.`}
          onClose={() => { setDialog(null); setFlagItem(null); }} onSubmit={(note) => decide.mutate({ items: flagItem ? [flagItem] : items(sel, "plan"), decision: "reject", note })} />
        <NoteDialog open={dialog === "flag"} title="Flag this hour" cta="Flag" busy={decide.isPending} description="A flagged hour loses its points until you unflag it. The flag is recorded in the activity log."
          onClose={() => { setDialog(null); setFlagItem(null); }} onSubmit={(note) => flagItem && decide.mutate({ items: [flagItem], decision: "flag", note })} />
        <Dialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent size="sm">
            <DialogHeader><DialogTitle>Edit and approve</DialogTitle><DialogDescription>Choose the task this hour should be; it's approved as that task.</DialogDescription></DialogHeader>
            <DialogBody>
              <Combobox aria-label="Task" value={null} searchPlaceholder="Search tasks…" placeholder="Choose a task…"
                options={tasks.filter((t) => t.active).map((t) => ({ value: String(t.id), label: t.name, hint: ptsText(+t.points), group: t.type || "Tasks" }))}
                onChange={(v) => v && decide.mutate({ items: items(sel, "plan"), decision: "approve", task: Number(v) })} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

export default function TeamBoard() {
  const today = useQuery(todayQuery);
  const t = today.data;
  const [week, setWeek] = useState<string | null>(null);
  const day = week ?? t?.today ?? "";
  const q = useQuery({ queryKey: ["board", day], enabled: !!day, queryFn: async () => (await api.get<Board>(`/team/board/?week=${day}`)).data });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const decide = useDecide(() => setPicked(new Set()));
  const colours = useMemo(() => typeColours(tasks.data ?? []), [tasks.data]);

  if (today.isLoading || (q.isLoading && !q.data)) return <PageSkeleton />;
  if (q.error || !q.data || !t) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const waitingOf = (m: Member): Item[] => m.days.flatMap((d) => d.plan.map((c, i) => (c?.state === "submitted" ? { work: m.work, day: d.day, slot: i, kind: "plan" as const } : null))).filter(Boolean) as Item[];
  const candidates = b.members.filter((m) => !m.own && m.pending.plan > 0);
  const ws = weekStartOf(day, dow(t.week_start));
  const member = b.members.find((m) => m.work === open) ?? null;

  return (
    <>
      <PageHeader title="Team Board" subtitle="Approve plans, deviations and unplanned hours. Nobody approves their own."
        actions={<div className="flex items-center gap-1.5">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => setWeek(addDays(ws, -7))}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label="Next week" onClick={() => setWeek(addDays(ws, 7))}><ChevronRight /></Button>
          <span className="ml-1 text-sm font-semibold">Week {b.week.no} · {fmt(b.week.start, { day: "numeric", month: "short" })} – {fmt(b.week.end, { day: "numeric", month: "short" })}</span>
          {!b.week.current && <Button variant="ghost" size="sm" onClick={() => setWeek(null)}>This week</Button>}
        </div>} />

      <div className="mb-5 grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.3fr)]">
        {([["Plan hours waiting", b.pending.plan, "Submitted, not decided yet"], ["Deviations waiting", b.pending.deviation, "A different task than the approved plan"],
          ["Unplanned waiting", b.pending.unplanned, b.unplanned_mode === "strict" ? "Strict mode: count once approved" : "None wait in provisional mode"]] as const).map(([label, n, hint]) => (
          <div key={label} className="card p-5">
            <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
            <div className="mt-2 text-[28px] font-semibold leading-tight tabular-nums">{n}</div>
            <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
          </div>
        ))}
        <TimeByType rows={b.coverage.map((c) => ({ ...c, colour: colours.get(c.type) ?? "var(--subtle-foreground)" }))} />
      </div>

      {b.members.length === 0 ? <div className="card"><EmptyState icon={<LayoutGrid />} title="No one to show">Give people a daily log in Team setup.</EmptyState></div> : (
        <section className="card overflow-hidden" aria-label="Team">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            {picked.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Selected people">
                <span className="text-sm font-medium">{picked.size} {picked.size === 1 ? "person" : "people"} selected</span>
                <Button size="sm" busy={decide.isPending} onClick={() => decide.mutate({ items: b.members.filter((m) => picked.has(m.work)).flatMap(waitingOf), decision: "approve" })}>
                  <CheckCheck /> Approve every waiting hour</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
            ) : <p className="text-sm text-muted-foreground">{candidates.length ? `${candidates.length} ${candidates.length === 1 ? "person has" : "people have"} hours waiting. Open a row to decide hour by hour, or select people to approve in bulk.` : "Nothing waits for a decision this week."}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="w-10 px-4 py-2.5"><Checkbox aria-label="Select everyone with hours waiting" checked={candidates.length > 0 && picked.size === candidates.length}
                  onCheckedChange={(v) => setPicked(v ? new Set(candidates.map((m) => m.work)) : new Set())} disabled={!candidates.length} /></th>
                <th className="px-2 py-2.5">Person</th><th className="px-2 py-2.5">Plan</th><th className="px-2 py-2.5">Planned</th>
                <th className="px-2 py-2.5">Waiting</th><th className="w-56 px-2 py-2.5">Week</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {b.members.map((m) => {
                  const waiting = m.pending.plan + m.pending.deviation + m.pending.unplanned;
                  return (
                    <tr key={m.work} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">{!m.own && m.pending.plan > 0 && <Checkbox aria-label={`Select ${m.person}`} checked={picked.has(m.work)}
                        onCheckedChange={(v) => { const n = new Set(picked); if (v) n.add(m.work); else n.delete(m.work); setPicked(n); }} />}</td>
                      <td className="px-2 py-3"><div className="flex items-center gap-2.5"><Avatar name={m.person} src={m.photo} size="sm" />
                        <div className="min-w-0"><div className="truncate font-medium">{m.person}{m.own && <Badge tone="outline" className="ml-2">You</Badge>}</div>
                          <div className="truncate text-xs text-muted-foreground">{m.role ?? "No job role"}</div></div></div></td>
                      <td className="px-2 py-3">{m.status ? <StatusPill status={STATUS_PILL[m.status]}>{m.status_label}</StatusPill> : <Badge tone="outline">Not planned</Badge>}</td>
                      <td className="px-2 py-3"><div className="w-32"><div className="text-xs tabular-nums"><b className="font-semibold">{num.format(m.planned_hours)}</b> / {num.format(m.target_hours)} h</div>
                        <Progress value={Math.min(m.planned_hours, m.target_hours || 1)} max={m.target_hours || 1} size="sm" label={`${m.person}: planned hours against target`} className="mt-1" /></div></td>
                      <td className="px-2 py-3"><div className="flex flex-wrap gap-1">
                        {m.pending.plan > 0 && <Badge tone="info">{m.pending.plan} planned</Badge>}
                        {m.pending.deviation > 0 && <Badge tone="warning">{m.pending.deviation} deviation{m.pending.deviation === 1 ? "" : "s"}</Badge>}
                        {m.pending.unplanned > 0 && <Badge tone="warning">{m.pending.unplanned} unplanned</Badge>}
                        {!waiting && <span className="text-xs text-subtle-foreground">—</span>}</div></td>
                      <td className="px-2 py-3"><MiniWeek m={m} /></td>
                      <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">
                        {!m.own && m.pending.plan > 0 && <Button size="sm" variant="secondary" busy={decide.isPending} onClick={() => decide.mutate({ items: waitingOf(m), decision: "approve" })}><Check /> Approve all</Button>}
                        <Button size="sm" variant={waiting && !m.own ? "primary" : "ghost"} onClick={() => setOpen(m.work)}>{waiting && !m.own ? "Review" : "Open"}</Button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-wrap gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground" aria-label="Legend">
            {[["approved", "Approved"], ["submitted", "Waiting"], ["rejected", "Rejected"], ["draft", "Draft"]].map(([k, l]) => (
              <li key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-1.5 w-4 rounded-full", SEG[k])} aria-hidden />{l}</li>))}
          </ul>
        </section>
      )}
      <Review m={member} tasks={tasks.data ?? []} open={open != null} onClose={() => setOpen(null)} strict={b.unplanned_mode === "strict"} />
    </>
  );
}
