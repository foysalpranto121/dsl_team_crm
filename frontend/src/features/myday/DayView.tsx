import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ClipboardCopy, CopyPlus, Info, Loader2, Lock, SlidersHorizontal, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "@/api/client";
import type { EntriesResponse, Entry, HourMeta, Sheet, Slot, Task } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { ErrorState } from "@/components/data/states";
import { Alert } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProgressRing } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MonthCard, TimeByType, WeekCard, WeekStrip, type DayInfo, type SlotTask } from "../log/parts";
import { addDays, dow, fmt, hoursText, monthEnd, monthStart, num, ptsText, range, typeColours, weekStartOf } from "../log/util";
import { counts, kindOf, missingReason, pad, reviewOf, summary, wire, type Hour } from "./rules";

/**
 * My Day → Day (SRS v0.5 FR-T1–T7, §6, D1): each hour shows the approved plan, and the member confirms it with one tap
 * (Done / Partly / Not done with a reason), or logs something else (a deviation, with a reason, that counts once a
 * supervisor approves it). Hours with no approved plan are unplanned: they count provisionally, or wait for approval in
 * strict mode. Changes save as you go.
 */

type Draft = { hours: Hour[]; remarks: string };
const Dot = ({ colour }: { colour: string }) => <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colour }} aria-hidden />;
const hoursOfEntry = (e: Entry | undefined): Hour[] => pad(e?.slots, null).map((task, i) => ({ task, meta: (e?.meta?.[i] as HourMeta) ?? {} }));

function ReviewBadge({ review, unplanned, strict }: { review: HourMeta["review"]; unplanned: boolean; strict: boolean }) {
  if (review === "pending") return <StatusPill status="info">Waiting for approval</StatusPill>;
  if (review === "approved") return <StatusPill status="good">Approved</StatusPill>;
  if (review === "rejected") return <StatusPill status="danger">Not approved · counts 0</StatusPill>;
  if (review === "flagged") return <StatusPill status="warning">Flagged · counts 0</StatusPill>;
  if (unplanned) return <Badge tone="outline">Unplanned{strict ? "" : " · counts for now"}</Badge>;
  return null;
}

function Reason({ value, onCommit, label, placeholder }: { value: string; onCommit: (v: string) => void; label: string; placeholder: string }) {
  return (
    <Input defaultValue={value} key={value} aria-label={label} placeholder={placeholder} maxLength={300} className="h-9 text-sm"
      onBlur={(e) => { if (e.target.value.trim() !== value.trim()) onCommit(e.target.value.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function More({ n, meta, onChange }: { n: number; meta: HourMeta; onChange: (m: HourMeta) => void }) {
  const [qty, setQty] = useState(meta.qty != null ? String(meta.qty) : "");
  const [ref, setRef] = useState(meta.ref ?? "");
  return (
    <Popover onOpenChange={(open) => { if (!open) onChange({ ...meta, qty: qty === "" ? null : Math.max(0, Math.round(+qty)), ref: ref.trim() }); }}>
      <Tip content="Quantity and output">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Quantity and output for hour ${n}`}><SlidersHorizontal /></Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72 space-y-3 p-4">
        <Field label="Quantity" hint="e.g. calls made, emails sent"><Input type="number" min={0} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Output reference" hint="A link, document or client name"><Input value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} /></Field>
      </PopoverContent>
    </Popover>
  );
}

function LogHour({ n, planned, hour, review, editable, options, previous, taskOf, strict, onChange }: {
  n: number; planned: SlotTask | null; hour: Hour; review: HourMeta["review"]; editable: boolean; options: ComboOption[];
  previous: SlotTask | null; taskOf: (id: Slot) => SlotTask | null; strict: boolean; onChange: (h: Hour) => void;
}) {
  const task = taskOf(hour.task);
  const kind = kindOf(planned?.id ?? null, hour);
  const meta = hour.meta;
  const set = (h: Partial<Hour>) => onChange({ task: h.task !== undefined ? h.task : hour.task, meta: h.meta ?? meta });
  const statusSwitch = (
    <Segmented label={`How hour ${n} went`} value={meta.status === "partly" ? "partly" : "done"}
      onChange={(s) => set({ meta: { ...meta, status: s } })} options={[{ key: "done", label: "Done" }, { key: "partly", label: "Partly" }]} />
  );
  const chip = (t: SlotTask, tone?: "warning") => (
    <span className={cn("inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium",
      tone === "warning" ? "border-warning/40 bg-warning-soft text-warning-text" : "border-border bg-muted/50")}>
      <Dot colour={t.colour} /><span className="truncate">{t.name}</span>
    </span>
  );
  const picker = (placeholder: string, onPick: (id: number | null) => void, value: Slot = hour.task) => (
    <Combobox options={options} value={value != null ? String(value) : null} onChange={(v) => onPick(v ? Number(v) : null)}
      placeholder={placeholder} searchPlaceholder="Search tasks…" emptyText="No task matches." aria-label={`Hour ${n}`} className="h-9 min-w-0 flex-1" />
  );

  let body: ReactNode;
  if (!editable) {
    body = kind === "planned" ? <span className="text-sm text-subtle-foreground">Not logged</span>
      : kind === "empty" ? <span className="text-sm text-subtle-foreground">Nothing logged</span>
      : kind === "not_done" ? <span className="text-sm">Not done · <span className="text-muted-foreground">{meta.reason}</span></span>
      : <div className="flex flex-wrap items-center gap-2">{task && chip(task, kind === "deviation" ? "warning" : undefined)}
          {meta.status === "partly" && <Badge tone="neutral">Partly done</Badge>}
          {meta.reason && <span className="text-xs text-muted-foreground">“{meta.reason}”</span>}
          <ReviewBadge review={review} unplanned={kind === "unplanned"} strict={strict} /></div>;
  } else if (kind === "planned") {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => set({ task: planned!.id, meta: { status: "done" } })}><Check /> Done</Button>
        <Button size="sm" variant="secondary" onClick={() => set({ task: planned!.id, meta: { status: "partly" } })}>Partly</Button>
        <Button size="sm" variant="ghost" onClick={() => set({ task: null, meta: { status: "not_done", reason: "" } })}>Not done</Button>
        <div className="min-w-48 flex-1">{picker("Did something else…", (id) => set({ task: id, meta: { status: "done", reason: "" } }), null)}</div>
      </div>
    );
  } else if (kind === "not_done") {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Not done</Badge>
        <div className="min-w-56 flex-1"><Reason value={meta.reason ?? ""} label={`Why hour ${n} wasn't done`} placeholder="Why wasn't it done? (needed)"
          onCommit={(reason) => set({ meta: { ...meta, reason } })} /></div>
      </div>
    );
  } else if (kind === "deviation") {
    body = (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1">{picker("Choose a task", (id) => set({ task: id }))}</div>
          {statusSwitch}<ReviewBadge review={review} unplanned={false} strict={strict} />
        </div>
        <Reason value={meta.reason ?? ""} label={`Why hour ${n} differs from the plan`} placeholder="Why something other than the plan? (needed)"
          onCommit={(reason) => set({ meta: { ...meta, reason } })} />
      </div>
    );
  } else if (kind === "as_planned") {
    body = <div className="flex flex-wrap items-center gap-2">{chip(task!)}{statusSwitch}<ReviewBadge review={review} unplanned={false} strict={strict} /></div>;
  } else {   // unplanned or empty
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">{picker("Add what you worked on", (id) => set({ task: id, meta: id ? { ...meta, status: meta.status ?? "done" } : {} }))}</div>
        {kind === "unplanned" && <>{statusSwitch}<ReviewBadge review={review} unplanned strict={strict} /></>}
      </div>
    );
  }

  return (
    <li className="group/hour flex items-start gap-2 py-2.5 sm:gap-3">
      <span className="grid w-9 shrink-0 justify-items-end pt-1 leading-none sm:w-12" aria-hidden>
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Hour</span>
        <span className="text-base font-semibold tabular-nums text-muted-foreground">{n}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {planned && kind !== "as_planned" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Dot colour={planned.colour} />Plan: <span className="font-medium text-foreground">{planned.name}</span></div>
        )}
        {body}
      </div>
      <span className="hidden w-14 shrink-0 pt-2 text-right text-xs font-medium tabular-nums text-muted-foreground sm:block">
        {task && counts(hour, review) ? ptsText(task.points) : ""}{meta.qty != null && <span className="block text-[11px]">×{meta.qty}</span>}
      </span>
      <span className="flex w-16 shrink-0 justify-end gap-0.5 pt-0.5">
        {editable && hour.task != null && <More n={n} meta={meta} onChange={(m) => set({ meta: m })} />}
        {editable && (hour.task != null || meta.status === "not_done") && (
          <Tip content={planned ? "Undo" : `Clear hour ${n}`}>
            <Button variant="ghost" size="icon-sm" aria-label={planned ? `Undo hour ${n}` : `Clear hour ${n}`} onClick={() => onChange({ task: null, meta: {} })}>
              {planned ? <Undo2 /> : <X />}</Button>
          </Tip>
        )}
        {editable && kind === "empty" && previous && (
          <Tip content={`Same as hour ${n - 1}: ${previous.name}`}>
            <Button variant="ghost" size="icon-sm" aria-label={`Same as hour ${n - 1} (${previous.name})`} onClick={() => set({ task: previous.id, meta: { status: "done" } })}><CopyPlus /></Button>
          </Tip>
        )}
      </span>
    </li>
  );
}

export function DayView({ work, day, weekStartDow, go }: {
  work: Sheet; day: string; weekStartDow: number; go: (next: { day?: string; tab?: string }) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const from = weekStartOf(monthStart(day), weekStartDow), to = addDays(weekStartOf(monthEnd(day), weekStartDow), 6);
  const data = useQuery({
    queryKey: ["entries", work.id, from, to],
    queryFn: async () => (await api.get<EntriesResponse>(`/team/sheets/${work.id}/entries/?from=${from}&to=${to}`)).data,
    refetchInterval: 60_000,
  });
  const d = data.data;
  const byDay = useMemo(() => new Map<string, Entry>((d?.entries ?? []).map((e) => [e.day, e])), [d]);
  const strict = d?.unplanned_mode === "strict";

  // ----- saving: each change saves by itself; picks in quick succession become one save -----
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  const timers = useRef<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  useEffect(() => { draftsRef.current = {}; setDrafts({}); setSavedAt({}); setError(""); }, [work.id]);

  const save = async (on: string) => {
    const draft = draftsRef.current[on];
    if (!draft) return;
    setSaving((s) => ({ ...s, [on]: true }));
    try {
      await api.put(`/team/sheets/${work.id}/entries/${on}/`, { slots: draft.hours.map((h) => h.task), remarks: draft.remarks, meta: draft.hours.map((h) => wire(h.meta)) });
      await qc.invalidateQueries({ queryKey: ["entries", work.id] });
      ["dashboard", "today", "huddle", "plan-week", "plan-history", "plans-mine"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setSavedAt((s) => ({ ...s, [on]: Date.now() }));
      setError("");
    } catch (e) {
      setError(`${fmt(on, { weekday: "long", day: "numeric", month: "long" })}: ${errorText(e)}`);
      await qc.invalidateQueries({ queryKey: ["entries", work.id] });
    } finally {
      if (draftsRef.current[on] === draft) {
        const { [on]: _, ...rest } = draftsRef.current;
        draftsRef.current = rest;
        setDrafts(rest);
      }
      setSaving((s) => ({ ...s, [on]: false }));
    }
  };
  const plannedOf = (x: string): Slot[] => pad(d?.planned?.[x], null);
  const change = (on: string, next: Draft) => {
    draftsRef.current = { ...draftsRef.current, [on]: next };
    setDrafts(draftsRef.current);
    clearTimeout(timers.current[on]);
    if (!missingReason(plannedOf(on), next.hours)) timers.current[on] = window.setTimeout(() => save(on), 400);
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  const colours = useMemo(() => typeColours(tasks.data ?? []), [tasks.data]);
  const taskMap = useMemo(() => {
    const m = new Map<number, SlotTask>();
    (tasks.data ?? []).forEach((x) => m.set(x.id, { id: x.id, name: x.name, type: x.type || "Other", points: +x.points, colour: colours.get(x.type || "Other")! }));
    return m;
  }, [tasks.data, colours]);
  const taskOf = (id: Slot) => (id != null ? taskMap.get(id) ?? null : null);
  const options = useMemo<ComboOption[]>(() => {
    const chosen = new Set(d?.choices ?? []);
    const opt = (x: Task, group: string): ComboOption => ({ value: String(x.id), label: x.name, hint: ptsText(+x.points), group,
      icon: <Dot colour={colours.get(x.type || "Other")!} />, keywords: [x.type] });
    return [...(tasks.data ?? []).filter((x) => chosen.has(x.id)).map((x) => opt(x, x.type || "Tasks")),
      ...(isAdmin ? (tasks.data ?? []).filter((x) => x.active && !chosen.has(x.id)).map((x) => opt(x, "Other tasks (admins only)")) : [])];
  }, [d?.choices, tasks.data, colours, isAdmin]);

  if (data.error || tasks.error) return <ErrorState error={data.error || tasks.error} onRetry={() => { data.refetch(); tasks.refetch(); }} />;
  if (!d || !tasks.data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-[32rem] w-full" /></div>;

  const hoursOf = (x: string): Hour[] => drafts[x]?.hours ?? hoursOfEntry(byDay.get(x));
  const reviewsOf = (x: string) => {
    const prev = hoursOfEntry(byDay.get(x)), planned = plannedOf(x);
    return hoursOf(x).map((h, i) => (drafts[x] ? reviewOf(planned[i], h, prev[i], strict) : h.meta.review));
  };
  const sumOf = (x: string) => summary(plannedOf(x), hoursOf(x), reviewsOf(x), (id) => taskMap.get(id)?.points ?? 0);
  const info = (x: string): DayInfo => {
    const s = sumOf(x);
    return { day: x, hours: s.output, points: s.points, weekend: d.weekend_days.includes(dow(x)), locked: !d.editable[x] && x < d.today, inMonth: x.slice(0, 7) === day.slice(0, 7) };
  };
  const weekStart = weekStartOf(day, weekStartDow);
  const weekDays = range(weekStart, addDays(weekStart, 6)).map(info);
  const week = d.weeks.find((w) => w.start <= day && day <= w.end);
  const counted = range(from, to).map(info).filter((x) => x.inMonth && (d.count_weekend || !x.weekend));
  const byType = new Map<string, number>();
  weekDays.forEach((x) => hoursOf(x.day).forEach((h, i) => { const k = taskOf(h.task); if (k && counts(h, reviewsOf(x.day)[i])) byType.set(k.type, (byType.get(k.type) ?? 0) + 1); }));

  const editable = !!d.editable[day];
  const hours = hoursOf(day), planned = plannedOf(day), reviews = reviewsOf(day), s = sumOf(day);
  const current: Draft = drafts[day] ?? { hours, remarks: byDay.get(day)?.remarks ?? "" };
  const isToday = day === d.today, weekend = d.weekend_days.includes(dow(day));
  const left = Math.max(0, d.seconds_to_lock - Math.round((now - data.dataUpdatedAt) / 1000));
  const missing = drafts[day] ? missingReason(planned, hours) : null;
  const pendingHere = reviews.filter((r) => r === "pending").length;
  const plannedOpen = planned.some((p, i) => p != null && hours[i].task == null && hours[i].meta.status !== "not_done");
  const previousDay = editable && s.logged === 0 && !planned.some(Boolean) ? range(from, addDays(day, -1)).reverse().find((x) => sumOf(x).logged > 0) : undefined;
  const setHour = (i: number, h: Hour) => { const next = [...hours]; next[i] = h; change(day, { ...current, hours: next }); };
  const longDay = fmt(day, { weekday: "long", day: "numeric", month: "long" });
  const weekPlanStatus = d.plan_weeks?.[weekStart];
  const status = saving[day] ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</>
    : missing ? <span className="text-warning-text">Add the reason to save</span>
    : drafts[day] ? "Saving soon…" : savedAt[day] ? <><Check className="size-3.5 text-success-text" aria-hidden /> Saved</>
    : editable ? <><Check className="size-3.5" aria-hidden /> Saves as you go</> : null;

  return (
    <>
      <WeekStrip days={weekDays} selected={day} today={d.today} onSelect={(x) => go({ day: x })} />
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="card overflow-hidden" aria-labelledby="day-title">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id="day-title" className="text-lg font-semibold">{longDay}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {isToday && <Badge tone="primary">Today</Badge>}
                {editable && isToday && d.lock_days && !isAdmin && <Badge tone={left < 2 * 3600 ? "warning" : "neutral"}>Locks in {Math.floor(left / 3600)}h {Math.floor((left % 3600) / 60)}m</Badge>}
                {!editable && <Badge tone="neutral"><Lock aria-hidden />{day < d.today ? "Locked" : "View only"}</Badge>}
                {weekend && <Badge tone="outline">Weekend{!d.count_weekend && " · not counted"}</Badge>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">{num.format(s.output)}<span className="text-sm font-normal text-muted-foreground"> h</span>
                <span className="mx-2 text-border" aria-hidden>|</span>{num.format(s.points)}<span className="text-sm font-normal text-muted-foreground"> pts</span></div>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-live="polite">{status}</div>
            </div>
          </div>

          {!editable && d.blocked[day] && (
            <p className="flex items-start gap-2 border-b border-border bg-muted/50 px-5 py-2.5 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{d.blocked[day]}</p>
          )}
          {editable && !planned.some(Boolean) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-info-soft/60 px-5 py-2.5 text-sm text-info-text">
              <Info className="size-4 shrink-0" aria-hidden />
              {weekPlanStatus === "submitted" ? "This week's plan is waiting for approval." : "There's no approved plan for this day."}{" "}
              {strict ? "Hours you log wait for your supervisor's approval." : "Hours you log count for now; your supervisor can review them."}
              <button type="button" className="font-semibold underline" onClick={() => go({ tab: "plan" })}>Open the plan</button>
            </p>
          )}
          {editable && isAdmin && !work.mine && day < d.today && (
            <p className="flex items-start gap-2 border-b border-border bg-warning-soft px-5 py-2.5 text-sm text-warning-text"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              You're correcting a past day. The change is recorded in the activity log.</p>
          )}
          {editable && (plannedOpen || previousDay) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
              {plannedOpen && (
                <Button size="sm" variant="soft" onClick={() => change(day, { ...current, hours: hours.map((h, i) =>
                  planned[i] != null && h.task == null && h.meta.status !== "not_done" ? { task: planned[i], meta: { status: "done" } } : h) })}>
                  <CheckCheck /> Confirm every planned hour as done</Button>
              )}
              {previousDay && (
                <Button size="sm" variant="secondary" onClick={() => change(day, { ...current, hours: hoursOf(previousDay).map((h) => (h.task != null ? { task: h.task, meta: { status: "done" } } : { task: null, meta: {} })) })}>
                  <ClipboardCopy /> Copy {fmt(previousDay, { weekday: "short", day: "numeric", month: "short" })} · {hoursText(sumOf(previousDay).logged)}</Button>
              )}
            </div>
          )}
          {missing && <p className="border-b border-border bg-warning-soft px-5 py-2.5 text-sm text-warning-text" role="alert">{missing}</p>}

          <ol className="divide-y divide-border/70 px-3 py-1 sm:px-5" aria-label={`Hours on ${longDay}`}>
            {hours.map((h, i) => (
              <LogHour key={i} n={i + 1} planned={taskOf(planned[i])} hour={h} review={reviews[i]} editable={editable} options={options} strict={strict}
                previous={i > 0 ? taskOf(hours[i - 1].task) : null} taskOf={taskOf} onChange={(next) => setHour(i, next)} />
            ))}
          </ol>

          <div className="border-t border-border px-5 py-4">
            <label htmlFor="day-notes" className="label">Notes for the day</label>
            {editable ? (
              <Textarea id="day-notes" key={`${work.id}-${day}-${byDay.get(day)?.updated_at ?? ""}`} defaultValue={current.remarks} maxLength={2000} rows={2}
                placeholder="Clients met, deals moved, anything the team should know"
                onBlur={(e) => { if (e.target.value.trim() !== current.remarks.trim()) change(day, { ...current, remarks: e.target.value }); }} />
            ) : <p id="day-notes" className="whitespace-pre-line text-sm text-muted-foreground">{current.remarks || "No notes."}</p>}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5" aria-labelledby="sum-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="sum-title" className="text-sm font-semibold">{isToday ? "Today" : fmt(day, { weekday: "long" })} at a glance</h2>
                <p className="text-xs text-muted-foreground">Output hours are the ones that count.</p>
              </div>
              <ProgressRing value={Math.round((s.adherence ?? 0) * 100)} max={100} size={56} stroke={6} tone={s.adherence != null && s.adherence >= 1 ? "success" : "primary"}
                label={`Adherence ${s.adherence == null ? "not applicable" : `${Math.round(s.adherence * 100)}%`}`}>
                <span className="text-xs font-semibold tabular-nums">{s.adherence == null ? "—" : `${Math.round(s.adherence * 100)}%`}</span>
              </ProgressRing>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {([["Planned (approved)", s.approved], ["Logged", s.logged], ["Output", s.output], ["Points", s.points]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{num.format(v)}{k !== "Points" && <span className="text-xs font-normal text-muted-foreground"> h</span>}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Adherence: planned hours done as planned{s.adherence == null ? " (nothing was planned)" : ""}.</p>
            {pendingHere > 0 && <p className="mt-2 text-xs font-medium text-info-text">{hoursText(pendingHere)} waiting for your supervisor.</p>}
          </section>
          <WeekCard week={week} days={weekDays} selected={day} today={d.today} onSelect={(x) => go({ day: x })} />
          <TimeByType rows={[...byType].map(([type, h]) => ({ type, hours: h, colour: colours.get(type)! })).sort((a, b) => b.hours - a.hours)} />
          <MonthCard month={fmt(day, { month: "long" })} hours={counted.reduce((a, x) => a + x.hours, 0)} points={counted.reduce((a, x) => a + x.points, 0)}
            targetPoints={+work.target_points} daysFilled={counted.filter((x) => x.hours > 0).length} />
        </aside>
      </div>
    </>
  );
}
