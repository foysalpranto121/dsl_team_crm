import { CopyPlus, Lock, X } from "lucide-react";
import type { WeekTotal } from "@/api/types";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Progress } from "@/components/ui/progress";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SLOTS, fmt, hoursText, num, ptsText, weekPace } from "./util";

/** Display pieces of the daily log. They hold no data of their own: the page passes everything in. */

export interface DayInfo { day: string; hours: number; points: number; weekend: boolean; locked: boolean; inMonth: boolean }
export interface SlotTask { id: number; name: string; type: string; points: number; colour: string }

/** Ten small segments: how many of the day's hours are filled in. */
export function HourMeter({ hours, className }: { hours: number; className?: string }) {
  return (
    <span className={cn("flex w-full max-w-14 gap-px", className)} aria-hidden>
      {Array.from({ length: SLOTS }, (_, i) => (
        <span key={i} className={cn("h-1 flex-1 rounded-full", i < hours ? "bg-primary" : "bg-border")} />
      ))}
    </span>
  );
}

// ---------- the week strip ----------

export function WeekStrip({ days, selected, today, onSelect }: { days: DayInfo[]; selected: string; today: string; onSelect: (day: string) => void }) {
  return (
    <div role="group" aria-label="Days of this week" className="grid grid-cols-7 gap-1.5 sm:gap-2">
      {days.map((d) => {
        const on = d.day === selected, isToday = d.day === today;
        return (
          <button key={d.day} type="button" onClick={() => onSelect(d.day)} aria-pressed={on} aria-current={isToday ? "date" : undefined}
            aria-label={`${fmt(d.day, { weekday: "long", day: "numeric", month: "long" })}: ${d.hours ? hoursText(d.hours) : "nothing logged"}${d.locked ? ", locked" : ""}`}
            className={cn("relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-1 pb-2 pt-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary-soft shadow-xs" : "border-border bg-card hover:border-primary/40 hover:bg-muted",
              d.weekend && !on && "bg-muted/60")}>
            <span className={cn("text-[11px] font-medium uppercase tracking-wide", on ? "text-primary-text" : "text-muted-foreground")}>{fmt(d.day, { weekday: "short" })}</span>
            <span className={cn("grid size-8 place-items-center rounded-full text-sm font-semibold tabular-nums",
              isToday ? "bg-primary text-primary-foreground" : on ? "text-primary-text" : "text-foreground")}>{fmt(d.day, { day: "numeric" })}</span>
            <HourMeter hours={d.hours} />
            <span className="text-[11px] tabular-nums text-muted-foreground">{d.hours ? `${num.format(d.hours)} h` : "—"}</span>
            {d.locked && <Lock className="absolute right-1.5 top-1.5 size-3 text-subtle-foreground" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

// ---------- one hour ----------

export function HourRow({ n, task, editable, options, previous, onChange }: {
  n: number; task: SlotTask | null; editable: boolean; options: ComboOption[]; previous: SlotTask | null; onChange: (id: number | null) => void;
}) {
  return (
    <li className="group/hour flex items-center gap-2 py-1.5 sm:gap-3">
      <span className="grid w-9 shrink-0 justify-items-end leading-none sm:w-12" aria-hidden>
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Hour</span>
        <span className="text-base font-semibold tabular-nums text-muted-foreground">{n}</span>
      </span>
      <div className="relative min-w-0 flex-1">
        {task && <span className="pointer-events-none absolute inset-y-1.5 left-0 z-10 w-1 rounded-full" style={{ background: task.colour }} aria-hidden />}
        {editable ? (
          <Combobox options={options} value={task ? String(task.id) : null} onChange={(v) => onChange(v ? Number(v) : null)}
            placeholder="Add what you worked on" searchPlaceholder="Search tasks…" emptyText="No task matches." aria-label={`Hour ${n}`}
            className={cn("h-11 pl-4", task ? "font-medium text-foreground" : "border-dashed bg-transparent")} />
        ) : (
          <div className={cn("flex h-11 items-center gap-2 rounded-lg px-4 text-sm", task ? "bg-muted/60 font-medium" : "text-subtle-foreground")}>
            {task ? <span className="truncate">{task.name}</span> : "Nothing logged"}
          </div>
        )}
      </div>
      <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground sm:block" title={task?.type}>{task?.type}</span>
      <span className="hidden w-14 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground sm:block">{task ? ptsText(task.points) : ""}</span>
      <span className="flex w-8 shrink-0 justify-center">
        {editable && task && (
          <Tip content={`Clear hour ${n}`}>
            <Button variant="ghost" size="icon-sm" aria-label={`Clear hour ${n}`} onClick={() => onChange(null)}
              className="opacity-60 transition-opacity group-hover/hour:opacity-100 focus-visible:opacity-100"><X /></Button>
          </Tip>
        )}
        {editable && !task && previous && (
          <Tip content={`Same as hour ${n - 1}: ${previous.name}`}>
            <Button variant="ghost" size="icon-sm" aria-label={`Same as hour ${n - 1} (${previous.name})`} onClick={() => onChange(previous.id)}><CopyPlus /></Button>
          </Tip>
        )}
      </span>
    </li>
  );
}

// ---------- side cards ----------

export function WeekCard({ week, days, selected, today, onSelect }: {
  week: WeekTotal | undefined; days: DayInfo[]; selected: string; today: string; onSelect: (day: string) => void;
}) {
  if (!week) return null;
  const pace = weekPace(week, today);
  return (
    <section className="card p-5" aria-labelledby="week-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="week-card" className="text-sm font-semibold">Week {week.no}</h2>
          <p className="text-xs text-muted-foreground">{fmt(week.start, { day: "numeric", month: "short" })} – {fmt(week.end, { day: "numeric", month: "short" })}</p>
        </div>
        {week.target_hours > 0 && pace && <StatusPill status={pace.status}>{pace.label}</StatusPill>}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{num.format(week.hours)} h</span>
        {week.target_hours > 0 && <span className="text-sm text-muted-foreground">of {num.format(week.target_hours)} h</span>}
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">{ptsText(week.points)}</span>
      </div>
      {week.target_hours > 0 && (
        <Progress value={Math.min(week.hours, week.target_hours)} max={week.target_hours} size="sm" tone={week.hours >= week.target_hours ? "success" : "primary"}
          label={`Week ${week.no}: ${num.format(week.hours)} of ${num.format(week.target_hours)} hours`} className="mt-3" />
      )}
      <div className="mt-5 grid grid-cols-7 gap-1.5" role="group" aria-label="Hours each day">
        {days.map((d) => (
          <button key={d.day} type="button" onClick={() => onSelect(d.day)} aria-label={`${fmt(d.day, { weekday: "long" })}: ${hoursText(d.hours)}`}
            className="group flex flex-col items-center gap-1.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex h-16 w-full items-end justify-center rounded-md bg-muted/70">
              <span className={cn("w-3/5 rounded-t-[4px] transition-colors", d.day === selected ? "bg-primary" : "bg-primary/45 group-hover:bg-primary/70")}
                style={{ height: `${(Math.min(d.hours, SLOTS) / SLOTS) * 100}%` }} />
            </span>
            <span className={cn("text-[11px]", d.day === selected ? "font-semibold text-foreground" : "text-muted-foreground")}>{fmt(d.day, { weekday: "narrow" })}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TimeByType({ rows }: { rows: { type: string; hours: number; colour: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.hours));
  return (
    <section className="card p-5" aria-labelledby="types-card">
      <h2 id="types-card" className="text-sm font-semibold">Where the week went</h2>
      <p className="text-xs text-muted-foreground">Hours by kind of work</p>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Nothing logged this week yet.</p> : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.type}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.colour }} aria-hidden />
                  <span className="truncate">{r.type}</span></span>
                <span className="tabular-nums text-muted-foreground">{num.format(r.hours)} h</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${(r.hours / max) * 100}%`, background: r.colour }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MonthCard({ month, hours, points, targetPoints, daysFilled }: { month: string; hours: number; points: number; targetPoints: number; daysFilled: number }) {
  return (
    <section className="card p-5" aria-labelledby="month-card">
      <h2 id="month-card" className="text-sm font-semibold">{month}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-4">
        <div><dt className="text-xs text-muted-foreground">Hours</dt><dd className="text-xl font-semibold tabular-nums">{num.format(hours)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Days logged</dt><dd className="text-xl font-semibold tabular-nums">{daysFilled}</dd></div>
      </dl>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Points</span>
          <span className="tabular-nums"><b className="font-semibold">{num.format(points)}</b>{targetPoints > 0 && <span className="text-muted-foreground"> of {num.format(targetPoints)}</span>}</span>
        </div>
        {targetPoints > 0 && <Progress value={Math.min(points, targetPoints)} max={targetPoints} size="sm" tone={points >= targetPoints ? "success" : "primary"}
          label={`${month}: ${num.format(points)} of ${num.format(targetPoints)} points`} className="mt-2" />}
      </div>
    </section>
  );
}

// ---------- the month ----------

export function MonthCalendar({ weeks, days, today, startDow, onOpen }: {
  weeks: WeekTotal[]; days: DayInfo[]; today: string; startDow: number; onOpen: (day: string) => void;
}) {
  const names = Array.from({ length: 7 }, (_, i) => fmt(`2026-11-0${1 + ((startDow + i) % 7)}`, { weekday: "short" }));   // 1 Nov 2026 is a Sunday
  const rows: DayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-muted/60 text-center text-xs font-medium text-muted-foreground lg:grid-cols-[repeat(7,minmax(0,1fr))_9rem]">
        {names.map((n) => <div key={n} className="py-2">{n}</div>)}
        <div className="hidden py-2 lg:block">Week</div>
      </div>
      {rows.map((row) => {
        const w = weeks.find((x) => x.start === row[0].day);
        const pace = w ? weekPace(w, today) : null;
        return (
          <div key={row[0].day} className="grid grid-cols-7 border-b border-border last:border-b-0 lg:grid-cols-[repeat(7,minmax(0,1fr))_9rem]">
            {row.map((d) => (
              <button key={d.day} type="button" onClick={() => onOpen(d.day)}
                aria-label={`${fmt(d.day, { weekday: "long", day: "numeric", month: "long" })}: ${d.hours ? `${hoursText(d.hours)}, ${num.format(d.points)} points` : "nothing logged"}`}
                className={cn("group flex min-h-20 flex-col gap-1 border-r border-border p-1.5 text-left transition-colors hover:bg-primary-soft/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-24 sm:p-2.5",
                  (d.weekend || !d.inMonth) && "bg-muted/50")}>
                <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  d.day === today ? "bg-primary text-primary-foreground" : d.inMonth ? "text-foreground" : "text-muted-foreground")}>
                  {d.inMonth ? fmt(d.day, { day: "numeric" }) : fmt(d.day, { day: "numeric", month: "short" })}</span>
                {d.hours > 0 ? (
                  <>
                    <span className={cn("mt-auto text-sm font-semibold tabular-nums sm:text-base", !d.inMonth && "text-muted-foreground")}>{num.format(d.hours)} h</span>
                    <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:block">{ptsText(d.points)}</span>
                    <HourMeter hours={d.hours} className="max-w-none" />
                  </>
                ) : <span className="mt-auto text-xs text-subtle-foreground">{d.day <= today && d.inMonth && !d.weekend ? "—" : ""}</span>}
              </button>
            ))}
            <div className="hidden flex-col justify-center gap-1 bg-muted/30 px-3 py-2 lg:flex">
              {w && <>
                <span className="text-[11px] font-medium text-muted-foreground">Week {w.no}</span>
                <span className="text-sm font-semibold tabular-nums">{num.format(w.hours)}{w.target_hours > 0 && <span className="font-normal text-muted-foreground"> / {num.format(w.target_hours)}</span>} h</span>
                {w.target_hours > 0 && pace && <StatusPill status={pace.status} className="self-start">{pace.label}</StatusPill>}
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
