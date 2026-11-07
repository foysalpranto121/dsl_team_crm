import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, ClipboardCopy, Info, ListChecks, Loader2, Lock, NotebookPen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import type { EntriesResponse, Entry, Sheet, Slot, Task } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar } from "@/components/Brand";
import DownloadExcel from "@/components/DownloadExcel";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Alert, PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { HourRow, MonthCalendar, MonthCard, TimeByType, WeekCard, WeekStrip, type DayInfo, type SlotTask } from "./parts";
import { addDays, addMonths, dow, fill, filled, fmt, hoursText, monthEnd, monthStart, num, ptsText, range, typeColours, weekStartOf } from "./util";

/**
 * Daily log: what each person worked on, hour by hour (the workbook's "Team Operation Sheet"). Pick a task for each
 * hour; hours and points add up by themselves. Same API and rules as before: members fill in today on their work log
 * (days lock at midnight) and plan ahead on their plan; admins can correct any day.
 */

type Draft = { slots: Slot[]; remarks: string };
type View = "day" | "month";
interface Person { key: string; name: string; mine: boolean; role: string | null; work?: Sheet; plan?: Sheet; position: number }

const personName = (s: Sheet) => s.person || s.owner_name || s.name.replace(/^Planning\s*-\s*/i, "");

/** The team's sheets grouped by person: each person has a work log and (usually) a plan. */
function groupPeople(sheets: Sheet[]): Person[] {
  const out = new Map<string, Person>();
  for (const s of [...sheets].sort((a, b) => a.position - b.position || a.id - b.id)) {
    let key = s.owner != null ? `u${s.owner}` : `n${personName(s).toLowerCase()}`;
    const kind = s.kind === "plan" ? "plan" : "work";
    if (out.get(key)?.[kind]) key = `${key}-${s.id}`;   // a second sheet of the same kind stays reachable as its own entry
    const p = out.get(key) ?? { key, name: personName(s), mine: false, role: null, position: s.position };
    p[kind] = s;
    p.mine ||= s.mine;
    p.role ??= s.role_name;
    out.set(key, p);
  }
  return [...out.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.position - b.position);
}

const Dot = ({ colour }: { colour: string }) => <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colour }} aria-hidden />;

export default function DailyLog() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = useQuery(todayQuery);
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: async () => (await api.get<Sheet[]>("/team/sheets/")).data });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });

  const people = useMemo(() => groupPeople(sheets.data ?? []), [sheets.data]);
  const all = sheets.data ?? [];
  const sheet = all.find((s) => s.id === Number(params.get("sheet"))) ?? people[0]?.work ?? people[0]?.plan;
  const person = people.find((p) => p.work?.id === sheet?.id || p.plan?.id === sheet?.id);

  const t = today.data;
  const startDow = t ? dow(t.week_start) : 6;
  const legacyMonth = params.get("month");   // links from the old Sheets page
  const day = params.get("day") ?? (legacyMonth && t && legacyMonth !== t.today.slice(0, 7) ? `${legacyMonth}-01` : t?.today ?? "");
  const view: View = params.get("view") === "month" ? "month" : "day";
  const from = day ? weekStartOf(monthStart(day), startDow) : "";
  const to = day ? addDays(weekStartOf(monthEnd(day), startDow), 6) : "";

  const data = useQuery({
    queryKey: ["entries", sheet?.id, from, to],
    queryFn: async () => (await api.get<EntriesResponse>(`/team/sheets/${sheet!.id}/entries/?from=${from}&to=${to}`)).data,
    enabled: !!sheet && !!day,
    refetchInterval: 60_000,          // other people's changes (e.g. an admin correction) appear within a minute
  });
  const d = data.data;
  const byDay = useMemo(() => new Map<string, Entry>((d?.entries ?? []).map((e) => [e.day, e])), [d]);

  // ----- saving: each change is saved by itself; quick picks in a row become one save -----
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  const timers = useRef<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  useEffect(() => { draftsRef.current = {}; setDrafts({}); setSavedAt({}); setError(""); }, [sheet?.id]);

  const save = async (sheetId: number, on: string) => {
    const draft = draftsRef.current[on];
    if (!draft) return;
    setSaving((s) => ({ ...s, [on]: true }));
    try {
      await api.put(`/team/sheets/${sheetId}/entries/${on}/`, { slots: draft.slots, remarks: draft.remarks });
      await qc.invalidateQueries({ queryKey: ["entries", sheetId] });
      ["dashboard", "today", "huddle"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setSavedAt((s) => ({ ...s, [on]: Date.now() }));
      setError("");
    } catch (e) {
      setError(`${fmt(on, { weekday: "long", day: "numeric", month: "long" })}: ${errorText(e)}`);
      await qc.invalidateQueries({ queryKey: ["entries", sheetId] });
    } finally {
      if (draftsRef.current[on] === draft) {   // nothing newer was typed while saving
        const { [on]: _, ...rest } = draftsRef.current;
        draftsRef.current = rest;
        setDrafts(rest);
      }
      setSaving((s) => ({ ...s, [on]: false }));
    }
  };
  const change = (on: string, next: Draft) => {
    const sheetId = sheet!.id;
    draftsRef.current = { ...draftsRef.current, [on]: next };
    setDrafts(draftsRef.current);
    clearTimeout(timers.current[on]);
    timers.current[on] = window.setTimeout(() => save(sheetId, on), 400);
  };

  // The lock countdown keeps ticking between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  // ----- tasks: what can be picked, and each type's colour -----
  const colours = useMemo(() => typeColours(tasks.data ?? []), [tasks.data]);
  const taskOf = useMemo(() => {
    const m = new Map<number, SlotTask>();
    (tasks.data ?? []).forEach((x) => m.set(x.id, { id: x.id, name: x.name, type: x.type || "Other", points: +x.points, colour: colours.get(x.type || "Other")! }));
    return m;
  }, [tasks.data, colours]);
  const options = useMemo<ComboOption[]>(() => {
    const chosen = new Set(d?.choices ?? []);
    const opt = (x: Task, group: string): ComboOption => ({ value: String(x.id), label: x.name, hint: ptsText(+x.points), group,
      icon: <Dot colour={colours.get(x.type || "Other")!} />, keywords: [x.type] });
    const mine = (tasks.data ?? []).filter((x) => chosen.has(x.id)).map((x) => opt(x, x.type || "Tasks"));
    const other = isAdmin ? (tasks.data ?? []).filter((x) => x.active && !chosen.has(x.id)).map((x) => opt(x, "Other tasks (admins only)")) : [];
    return [...mine, ...other];
  }, [d?.choices, tasks.data, colours, isAdmin]);

  // ----- the plan for the selected day, offered on an empty work-log day -----
  const current = drafts[day] ?? { slots: byDay.get(day)?.slots ?? [], remarks: byDay.get(day)?.remarks ?? "" };
  const editable = !!d?.editable[day];
  const planSheet = sheet?.kind === "work" ? person?.plan : undefined;
  const plan = useQuery({
    queryKey: ["entries", planSheet?.id, day, day],
    queryFn: async () => (await api.get<EntriesResponse>(`/team/sheets/${planSheet!.id}/entries/?from=${day}&to=${day}`)).data,
    enabled: !!planSheet && editable && view === "day" && filled(current.slots) === 0,
  });

  if (sheets.isLoading || tasks.isLoading || today.isLoading) return <PageSkeleton />;
  const loadError = sheets.error || tasks.error || today.error;
  if (loadError) return <ErrorState error={loadError} onRetry={() => { sheets.refetch(); tasks.refetch(); today.refetch(); }} />;
  if (!sheet || !t) {
    return (
      <>
        <PageHeader title="Daily log" />
        <div className="card"><EmptyState icon={<NotebookPen />} title="No daily logs yet" action={isAdmin ? <Button asChild><Link to="/admin/settings">Set them up in Team setup</Link></Button> : undefined}>
          {isAdmin ? "Give each person a daily log (and a plan) in Team setup." : "An admin needs to set up the team's daily logs first."}
        </EmptyState></div>
      </>
    );
  }

  const go = (next: Partial<Record<"sheet" | "day" | "view", string>>) => {
    const p = new URLSearchParams(params);
    p.delete("month");
    Object.entries(next).forEach(([k, v]) => p.set(k, v!));
    if (!p.get("sheet")) p.set("sheet", String(sheet.id));
    setParams(p, { replace: true });
  };

  // ----- the numbers, with unsaved picks counted at once -----
  const slotsOf = (x: string) => drafts[x]?.slots ?? byDay.get(x)?.slots ?? [];
  const hoursOf = (x: string) => (drafts[x] ? filled(drafts[x].slots) : byDay.get(x)?.hours ?? 0);
  const pointsOf = (x: string) => (drafts[x] ? drafts[x].slots.reduce<number>((s, v) => s + (v != null ? taskOf.get(v)?.points ?? 0 : 0), 0) : byDay.get(x)?.points ?? 0);
  const info = (x: string): DayInfo => ({ day: x, hours: hoursOf(x), points: pointsOf(x), weekend: !!d?.weekend_days.includes(dow(x)),
    locked: !!d && !d.editable[x] && x < d.today, inMonth: x.slice(0, 7) === day.slice(0, 7) });
  const weekStart = weekStartOf(day, startDow);
  const weekDays = range(weekStart, addDays(weekStart, 6)).map(info);
  const week = d?.weeks.find((w) => w.start <= day && day <= w.end);
  const monthDays = d ? range(from, to).map(info) : [];
  const counted = monthDays.filter((x) => x.inMonth && (d!.count_weekend || !x.weekend));
  const byType = new Map<string, number>();
  weekDays.forEach((x) => slotsOf(x.day).forEach((v) => { const k = v != null ? taskOf.get(v) : undefined; if (k) byType.set(k.type, (byType.get(k.type) ?? 0) + 1); }));
  const typeRows = [...byType].map(([type, hours]) => ({ type, hours, colour: colours.get(type)! })).sort((a, b) => b.hours - a.hours);
  const monthCard = <MonthCard month={fmt(day, { month: "long" })} hours={counted.reduce((s, x) => s + x.hours, 0)} points={counted.reduce((s, x) => s + x.points, 0)}
    targetPoints={sheet.kind === "work" ? +sheet.target_points : 0} daysFilled={counted.filter((x) => x.hours > 0).length} />;

  const slots = fill(current.slots);
  const dayHours = filled(slots), dayPoints = pointsOf(day);
  const isToday = day === t.today, weekend = !!d?.weekend_days.includes(dow(day));
  const left = d ? Math.max(0, d.seconds_to_lock - Math.round((now - data.dataUpdatedAt) / 1000)) : 0;
  const reason = d?.blocked[day];
  const planEntry = plan.data?.entries.find((e) => e.day === day);
  const planHours = planEntry ? filled(planEntry.slots) : 0;
  const previousDay = editable && dayHours === 0 ? range(from, addDays(day, -1)).reverse().find((x) => hoursOf(x) > 0) : undefined;
  const setSlot = (i: number, id: number | null) => { const s = [...slots]; s[i] = id; change(day, { ...current, slots: s }); };
  const status = saving[day] ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</>
    : drafts[day] ? "Saving soon…" : savedAt[day] ? <><Check className="size-3.5 text-success-text" aria-hidden /> Saved</>
    : editable ? <><Check className="size-3.5" aria-hidden /> Saves as you go</> : null;

  const personOptions: ComboOption[] = people.map((p) => ({ value: p.key, label: p.name, group: p.mine ? "You" : "Team",
    hint: p.role ?? undefined, icon: <Avatar name={p.name} size="xs" /> }));
  const kindOptions = person?.work && person?.plan ? [{ key: "work" as const, label: "Work log" }, { key: "plan" as const, label: "Plan" }] : null;
  const longDay = fmt(day, { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader title="Daily log"
        subtitle={sheet.kind === "plan" ? "Plan your hours ahead. Plans don't count in scores." : "What you worked on, hour by hour. Hours and points add up by themselves."}
        actions={<>
          <Combobox options={personOptions} value={person?.key ?? null} aria-label="Whose daily log" searchPlaceholder="Search people…" className="w-60"
            onChange={(k) => { const p = people.find((x) => x.key === k); const s = (sheet.kind === "plan" ? p?.plan : p?.work) ?? p?.work ?? p?.plan; if (s) go({ sheet: String(s.id) }); }} />
          {kindOptions && <Segmented label="Work log or plan" value={sheet.kind === "plan" ? "plan" : "work"} options={kindOptions}
            onChange={(k) => { const s = k === "plan" ? person?.plan : person?.work; if (s) go({ sheet: String(s.id) }); }} />}
          <DownloadExcel year={+day.slice(0, 4)} sheet={sheet.id} />
        </>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="icon" aria-label={view === "day" ? "Previous week" : "Previous month"}
            onClick={() => go({ day: view === "day" ? addDays(day, -7) : addMonths(day, -1) })}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label={view === "day" ? "Next week" : "Next month"}
            onClick={() => go({ day: view === "day" ? addDays(day, 7) : addMonths(day, 1) })}><ChevronRight /></Button>
          <h2 className="ml-2 text-base font-semibold">
            {view === "day" ? <>{week ? `Week ${week.no} · ` : ""}{fmt(weekStart, { day: "numeric", month: "short" })} – {fmt(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" })}</>
              : fmt(day, { month: "long", year: "numeric" })}
          </h2>
          {day !== t.today && <Button variant="ghost" size="sm" className="ml-1" onClick={() => go({ day: t.today })}>Today</Button>}
        </div>
        <Segmented label="View" value={view} onChange={(v) => go({ view: v })}
          options={[{ key: "day", label: "Day", icon: <CalendarDays /> }, { key: "month", label: "Month", icon: <CalendarRange /> }]} />
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {data.error && <ErrorState error={data.error} onRetry={() => data.refetch()} />}

      {!d ? (
        !data.error && <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-[32rem] w-full" /></div>
      ) : view === "month" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <MonthCalendar weeks={d.weeks} days={monthDays} today={d.today} startDow={startDow} onOpen={(x) => go({ day: x, view: "day" })} />
          <aside className="space-y-5">
            {monthCard}
            {!d.count_weekend && <p className="text-xs text-muted-foreground">Weekend days are shown but don't count in totals.</p>}
          </aside>
        </div>
      ) : (
        <>
          <WeekStrip days={weekDays} selected={day} today={d.today} onSelect={(x) => go({ day: x })} />
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="card overflow-hidden" aria-labelledby="day-title">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h2 id="day-title" className="text-lg font-semibold">{longDay}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {isToday && <Badge tone="primary">Today</Badge>}
                    {editable && isToday && d.lock_days && !isAdmin && sheet.kind === "work" && (
                      <Badge tone={left < 2 * 3600 ? "warning" : "neutral"}>Locks in {Math.floor(left / 3600)}h {Math.floor((left % 3600) / 60)}m</Badge>
                    )}
                    {!editable && <Badge tone="neutral"><Lock aria-hidden />{day < d.today ? "Locked" : "View only"}</Badge>}
                    {weekend && <Badge tone="outline">Weekend{!d.count_weekend && " · not counted"}</Badge>}
                    {sheet.kind === "plan" && <Badge tone="info">Plan</Badge>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums">{num.format(dayHours)}<span className="text-sm font-normal text-muted-foreground"> h</span>
                    <span className="mx-2 text-border" aria-hidden>|</span>{num.format(dayPoints)}<span className="text-sm font-normal text-muted-foreground"> pts</span></div>
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-live="polite">{status}</div>
                </div>
              </div>

              {!editable && reason && (
                <p className="flex items-start gap-2 border-b border-border bg-muted/50 px-5 py-2.5 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{reason}</p>
              )}
              {editable && isAdmin && !sheet.mine && day < d.today && (
                <p className="flex items-start gap-2 border-b border-border bg-warning-soft px-5 py-2.5 text-sm text-warning-text"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  You're correcting a past day for {person?.name ?? "someone else"}. The change is recorded in the activity log.</p>
              )}

              {editable && dayHours === 0 && (planHours > 0 || previousDay) && (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                  <span className="text-sm text-muted-foreground">Start from:</span>
                  {planEntry && planHours > 0 && (
                    <Button variant="soft" size="sm" onClick={() => change(day, { ...current, slots: fill(planEntry.slots) })}>
                      <ListChecks /> {isToday ? "Today's plan" : "The plan"} · {hoursText(planHours)}</Button>
                  )}
                  {previousDay && (
                    <Button variant="secondary" size="sm" onClick={() => change(day, { ...current, slots: fill(slotsOf(previousDay)) })}>
                      <ClipboardCopy /> Copy {fmt(previousDay, { weekday: "short", day: "numeric", month: "short" })} · {hoursText(hoursOf(previousDay))}</Button>
                  )}
                </div>
              )}

              <ol className="divide-y divide-border/70 px-3 py-2 sm:px-5" aria-label={`Hours on ${longDay}`}>
                {slots.map((v, i) => {
                  const task = v != null ? taskOf.get(v) ?? null : null;
                  const rowOptions = task && !options.some((o) => o.value === String(task.id))
                    ? [{ value: String(task.id), label: `${task.name} (not in this list)`, group: "Logged before", icon: <Dot colour={task.colour} /> }, ...options] : options;
                  const prev = i > 0 && slots[i - 1] != null ? taskOf.get(slots[i - 1]!) ?? null : null;
                  return <HourRow key={i} n={i + 1} task={task} editable={editable} options={rowOptions} previous={prev} onChange={(id) => setSlot(i, id)} />;
                })}
              </ol>

              <div className="border-t border-border px-5 py-4">
                <label htmlFor="day-notes" className="label">Notes for the day</label>
                {editable ? (
                  <Textarea id="day-notes" key={`${sheet.id}-${day}-${byDay.get(day)?.updated_at ?? ""}`} defaultValue={current.remarks} maxLength={2000} rows={2}
                    placeholder="Clients met, deals moved, anything the team should know"
                    onBlur={(e) => { if (e.target.value.trim() !== current.remarks.trim()) change(day, { ...current, remarks: e.target.value }); }} />
                ) : <p id="day-notes" className="whitespace-pre-line text-sm text-muted-foreground">{current.remarks || "No notes."}</p>}
              </div>
              <p className="border-t border-border bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
                Each filled hour counts 1 hour; points come from the task. {sheet.kind === "work"
                  ? isAdmin ? "As an admin you can correct any day." : d.lock_days ? `Days lock at midnight (${d.timezone}); ask an admin if a locked day needs a correction.` : "Days don't lock."
                  : "A plan can be filled in for any day ahead."}
              </p>
            </section>

            <aside className="space-y-5">
              <WeekCard week={week} days={weekDays} selected={day} today={d.today} onSelect={(x) => go({ day: x })} />
              <TimeByType rows={typeRows} />
              {monthCard}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
