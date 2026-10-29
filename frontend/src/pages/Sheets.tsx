import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, Lock, Star, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorText } from "../api/client";
import type { EntriesResponse, Entry, Sheet, Slot, Task, Today, WeekTotal } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { PACE } from "./Dashboard";

const SLOTS = 10;
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
};
const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const monthLabel = (ym: string) => utc(ym + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (s: string) => utc(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const shortDate = (s: string) => utc(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const fill = (slots: Slot[]) => [...slots, ...Array(SLOTS).fill(null)].slice(0, SLOTS) as Slot[];

type Draft = { slots: Slot[]; remarks: string };

function SlotCell({ value, editable, tasks, groups, extra, onChange, label }: {
  value: Slot; editable: boolean; tasks: Map<number, Task>; groups: [string, Task[]][]; extra: Task[]; onChange: (v: Slot) => void; label: string;
}) {
  const t = value != null ? tasks.get(value) : undefined;
  if (!editable) {
    return t ? <span title={`${t.name} · ${nf.format(+t.points)} pts`} className="block w-36 truncate rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 dark:bg-brand-400/15 dark:text-brand-100">{t.name}</span>
      : <span className="block w-36 px-2 text-xs text-slate-300 dark:text-white/15">—</span>;
  }
  const offered = value == null || groups.some(([, ts]) => ts.some((x) => x.id === value)) || extra.some((x) => x.id === value);
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      title={t ? `${t.name} · ${nf.format(+t.points)} pts` : "Choose what you did in this hour"}
      className={clsx("w-36 rounded-md border px-1.5 py-1 text-xs focus:outline-2 focus:outline-brand-400",
        t ? "border-brand-200 bg-brand-50 font-medium text-brand-800 dark:border-brand-400/30 dark:bg-brand-400/15 dark:text-brand-100"
          : "border-dashed border-slate-300 bg-white text-slate-400 dark:border-white/15 dark:bg-transparent")}>
      <option value="">—</option>
      {!offered && t && <option value={t.id}>{t.name} (not in your list)</option>}
      {groups.map(([type, ts]) => (
        <optgroup key={type} label={type || "Tasks"}>{ts.map((x) => <option key={x.id} value={x.id}>{x.name} · {nf.format(+x.points)}</option>)}</optgroup>
      ))}
      {extra.length > 0 && <optgroup label="Other tasks (admin)">{extra.map((x) => <option key={x.id} value={x.id}>{x.name} · {nf.format(+x.points)}</option>)}</optgroup>}
    </select>
  );
}

function WeekRow({ w, today }: { w: WeekTotal; today: string }) {
  const done = w.end < today;
  const st = PACE[w.status.key];
  return (
    <tr className="bg-slate-50 text-xs dark:bg-white/[0.03]">
      <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold text-slate-600 dark:bg-[#0c1f3a] dark:text-slate-300">Week {w.no}</td>
      <td colSpan={SLOTS + 1} className="px-3 py-2 text-slate-500">
        {shortDate(w.start)} – {shortDate(w.end)} · whole week, Saturday to Friday
        {w.target_hours > 0 && <> · target {nf.format(w.target_hours)} h</>}
        {w.target_hours > 0 && <span className="ml-2">{done ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>In progress</Badge>}</span>}
      </td>
      <td className="num px-3 py-2 text-right font-semibold">{w.hours} h</td>
      <td className="num px-3 py-2 text-right font-semibold">{nf.format(w.points)}</td>
    </tr>
  );
}

export default function Sheets() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = useQuery({ queryKey: ["today"], queryFn: async () => (await api.get<Today>("/team/today/")).data });
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: async () => (await api.get<Sheet[]>("/team/sheets/")).data });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });

  const list = useMemo(() => [...(sheets.data ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine) || a.position - b.position || a.id - b.id), [sheets.data]);
  const sheetId = Number(params.get("sheet")) || list[0]?.id;
  const sheet = list.find((s) => s.id === sheetId);
  const month = params.get("month") || today.data?.today.slice(0, 7) || "";
  const range = month ? monthRange(month) : null;
  const key = ["entries", sheetId, month];
  const data = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<EntriesResponse>(`/team/sheets/${sheetId}/entries/?from=${range!.from}&to=${range!.to}`)).data,
    enabled: !!sheetId && !!range,
    refetchInterval: 60_000,          // other people's changes (e.g. an admin correction) appear within a minute
  });

  // When the date moves into a new month while you're looking at the current month, follow it.
  const todayIso = today.data?.today;
  const lastToday = useRef(todayIso);
  useEffect(() => {
    const prev = lastToday.current;
    if (todayIso && prev && todayIso.slice(0, 7) !== prev.slice(0, 7) && month === prev.slice(0, 7)) {
      setParams((p) => { const n = new URLSearchParams(p); n.set("month", todayIso.slice(0, 7)); return n; }, { replace: true });
    }
    lastToday.current = todayIso;
  }, [todayIso, month, setParams]);

  // The lock countdown keeps ticking between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  // Open on today's row.
  const scrolled = useRef("");
  useEffect(() => {
    const d = data.data;
    if (!d || scrolled.current === `${sheetId}|${month}` || d.today < d.from || d.today > d.to) return;
    scrolled.current = `${sheetId}|${month}`;
    requestAnimationFrame(() => document.getElementById(`day-${d.today}`)?.scrollIntoView({ block: "center" }));
  }, [data.data, sheetId, month]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  const timers = useRef<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  useEffect(() => { setDrafts({}); draftsRef.current = {}; setError(""); }, [sheetId, month]);

  const taskMap = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const { groups, extra } = useMemo(() => {
    const chosen = new Set(data.data?.choices ?? []);
    const g = new Map<string, Task[]>();
    (tasks.data ?? []).filter((t) => chosen.has(t.id)).forEach((t) => g.set(t.type, [...(g.get(t.type) ?? []), t]));
    const other = user?.role === "admin" ? (tasks.data ?? []).filter((t) => t.active && !chosen.has(t.id)) : [];
    return { groups: [...g.entries()], extra: other };
  }, [data.data?.choices, tasks.data, user?.role]);

  if (sheets.isLoading || tasks.isLoading || today.isLoading) return <Spinner />;
  const loadError = sheets.error || tasks.error || today.error;
  if (loadError) return <Alert>{errorText(loadError)}</Alert>;
  if (!list.length) {
    return (<><PageHeader title="Sheets" />
      <Card><EmptyState icon={<Table2 />} title="No sheets yet" action={user?.role === "admin" ? <Link to="/admin/settings"><Button>Create sheets</Button></Link> : undefined}>
        {user?.role === "admin" ? "Create a sheet for each person in Team setup." : "An admin needs to create the team's sheets first."}
      </EmptyState></Card></>);
  }

  const go = (next: { sheet?: number; month?: string }) => setParams({ sheet: String(next.sheet ?? sheetId), month: next.month ?? month }, { replace: true });
  const d = data.data;
  const byDay = new Map<string, Entry>((d?.entries ?? []).map((e) => [e.day, e]));

  const save = async (day: string) => {
    const draft = draftsRef.current[day];
    if (!draft) return;
    setSaving((s) => ({ ...s, [day]: true }));
    try {
      await api.put(`/team/sheets/${sheetId}/entries/${day}/`, { slots: draft.slots, remarks: draft.remarks });
      await qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      setError("");
    } catch (e) {
      setError(`${dayLabel(day)}: ${errorText(e)}`);
      await qc.invalidateQueries({ queryKey: key });
    } finally {
      if (draftsRef.current[day] === draft) {          // nothing newer was typed while saving
        const { [day]: _, ...rest } = draftsRef.current;
        draftsRef.current = rest; setDrafts(rest);
      }
      setSaving((s) => ({ ...s, [day]: false }));
    }
  };
  const change = (day: string, next: Draft) => {
    draftsRef.current = { ...draftsRef.current, [day]: next };
    setDrafts(draftsRef.current);
    clearTimeout(timers.current[day]);
    timers.current[day] = window.setTimeout(() => save(day), 350);   // several quick picks become one save
  };

  const days: string[] = [];
  if (d) for (let x = d.from; x <= d.to; x = addDays(x, 1)) days.push(x);
  const weekOf = (day: string) => d?.weeks.find((w) => w.start <= day && day <= w.end);
  const mineEditableToday = d && d.editable[d.today];
  const thisWeek = d && weekOf(d.today);
  const isAdmin = user?.role === "admin";
  const left = d ? Math.max(0, d.seconds_to_lock - Math.round((now - data.dataUpdatedAt) / 1000)) : 0;
  const lockText = !d ? "" : isAdmin ? "Admin: you can correct any day" : !d.lock_days ? "Lock is off: any day can be changed"
    : mineEditableToday ? `Today locks in ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m` : "View only";

  return (
    <>
      <PageHeader title="Sheets" subtitle="Pick what you did in each hour. Hours and points are added up for you."
        actions={<div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Previous month" onClick={() => go({ month: shiftMonth(month, -1) })}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
          <Button variant="secondary" aria-label="Next month" onClick={() => go({ month: shiftMonth(month, 1) })}><ChevronRight className="size-4" /></Button>
          {month !== today.data!.today.slice(0, 7) && <Button variant="ghost" onClick={() => go({ month: today.data!.today.slice(0, 7) })}>This month</Button>}
        </div>} />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Choose a sheet">
        {list.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === sheetId} onClick={() => go({ sheet: s.id })}
            className={clsx("rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              s.id === sheetId ? "border-brand-700 bg-brand-700 text-white dark:border-brand-300 dark:bg-brand-300 dark:text-brand-950"
                : "border-slate-300 bg-white text-slate-700 hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-200")}>
            {s.name}{s.mine && <span className="ml-1.5 rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">You</span>}
            {s.kind === "plan" && <span className="ml-1.5 text-xs opacity-70">plan</span>}
          </button>
        ))}
      </div>

      {sheet && d && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: <Clock />, label: `Hours in ${monthLabel(month).split(" ")[0]}`, value: `${d.totals.hours} h`, sub: `${days.filter((x) => (byDay.get(x)?.hours ?? 0) > 0).length} days filled in` },
            { icon: <Star />, label: "Points this month", value: nf.format(d.totals.points), sub: +sheet.target_points ? `target ${nf.format(+sheet.target_points)}` : "no monthly target" },
            { icon: <CalendarDays />, label: thisWeek ? `This week (week ${thisWeek.no})` : "This week", value: thisWeek ? `${thisWeek.hours} h` : "—", sub: +sheet.target_hours ? `target ${nf.format(+sheet.target_hours)} h a week` : "no weekly target" },
            { icon: <Lock />, label: sheet.kind === "plan" ? "Plan · doesn't count in scores" : sheet.role_name || "No job role", value: sheet.person || sheet.owner_name || sheet.name, sub: lockText },
          ].map((c) => (
            <Card key={c.label} className="flex items-start gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 [&>svg]:size-4 dark:bg-white/10 dark:text-brand-200">{c.icon}</span>
              <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-500">{c.label}</div>
                <div className="num truncate text-lg font-medium">{c.value}</div><div className="truncate text-xs text-slate-500">{c.sub}</div></div>
            </Card>
          ))}
        </div>
      )}

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {data.error && <Alert>{errorText(data.error)}</Alert>}
      {data.isLoading && <Spinner label="Loading the sheet…" />}

      {d && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="sticky left-0 z-20 border-b border-slate-200 bg-white px-3 py-2.5 font-semibold dark:border-white/10 dark:bg-[#0a1d36]">Day</th>
                  {Array.from({ length: SLOTS }, (_, i) => <th key={i} className="border-b border-slate-200 px-1.5 py-2.5 font-semibold dark:border-white/10">H-{i + 1}</th>)}
                  <th className="border-b border-slate-200 px-2 py-2.5 font-semibold dark:border-white/10">Remarks</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold dark:border-white/10">Hours</th>
                  <th className="border-b border-slate-200 px-3 py-2.5 text-right font-semibold dark:border-white/10">Points</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const entry = byDay.get(day);
                  const draft = drafts[day];
                  const cur: Draft = draft ?? { slots: entry?.slots ?? [], remarks: entry?.remarks ?? "" };
                  const slots = fill(cur.slots);
                  const editable = d.editable[day];
                  const weekend = d.weekend_days.includes(utc(day).getUTCDay());
                  // while a change is saving, show the sum right away; the server's numbers replace it when saved
                  const hours = draft ? slots.filter((s) => s != null).length : entry?.hours ?? 0;
                  const points = draft ? slots.reduce<number>((s, v) => s + (v != null ? +(taskMap.get(v)?.points ?? 0) : 0), 0) : entry?.points ?? 0;
                  const w = weekOf(day);
                  const showWeek = w && (day === w.end || day === d.to);
                  const isToday = day === d.today;
                  return [
                    <tr key={day} id={`day-${day}`} title={d.blocked[day]}
                      className={clsx("group", isToday && "bg-accent-500/[0.06]", weekend && !isToday && "bg-slate-50/70 dark:bg-white/[0.02]")}>
                      <td className={clsx("sticky left-0 z-10 border-b border-slate-100 px-3 py-1.5 whitespace-nowrap dark:border-white/5",
                        isToday ? "bg-[#fdf2f2] dark:bg-[#1d1a2e]" : weekend ? "bg-slate-50 dark:bg-[#0b1d37]" : "bg-white dark:bg-[#0a1a31]")}>
                        <div className="flex items-center gap-1.5">
                          <span className={clsx("font-semibold", isToday && "text-accent-600 dark:text-accent-400")}>{dayLabel(day)}</span>
                          {isToday && <Badge tone="accent">Today</Badge>}
                          {weekend && <span className="text-[10px] uppercase text-slate-400">weekend</span>}
                          {!editable && !isAdmin && day <= d.today && <Lock className="size-3 text-slate-400" aria-label="Locked" />}
                          {saving[day] && <Loader2 className="size-3.5 animate-spin text-brand-500" aria-label="Saving" />}
                        </div>
                      </td>
                      {slots.map((v, i) => (
                        <td key={i} className="border-b border-slate-100 px-1.5 py-1.5 dark:border-white/5">
                          <SlotCell value={v} editable={editable} tasks={taskMap} groups={groups} extra={extra} label={`${dayLabel(day)} hour ${i + 1}`}
                            onChange={(nv) => { const s = [...slots]; s[i] = nv; change(day, { ...cur, slots: s }); }} />
                        </td>
                      ))}
                      <td className="border-b border-slate-100 px-2 py-1.5 dark:border-white/5">
                        {editable ? (
                          <input defaultValue={cur.remarks} key={`${day}-${entry?.updated_at ?? ""}`} aria-label={`Remarks for ${dayLabel(day)}`} maxLength={2000}
                            placeholder="Remarks" className="w-48 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs focus:outline-2 focus:outline-brand-400 dark:border-white/10"
                            onBlur={(e) => { if (e.target.value.trim() !== cur.remarks.trim()) change(day, { ...cur, remarks: e.target.value }); }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                        ) : <span className="block w-48 truncate text-xs text-slate-500" title={cur.remarks}>{cur.remarks}</span>}
                      </td>
                      <td className="num border-b border-slate-100 px-3 py-1.5 text-right dark:border-white/5">{hours || <span className="text-slate-300 dark:text-white/20">0</span>}</td>
                      <td className="num border-b border-slate-100 px-3 py-1.5 text-right dark:border-white/5">{points ? nf.format(points) : <span className="text-slate-300 dark:text-white/20">0</span>}</td>
                    </tr>,
                    showWeek ? <WeekRow key={`w-${w.start}`} w={w} today={d.today} /> : null,
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="bg-brand-700 text-white dark:bg-brand-800">
                  <td className="sticky left-0 z-10 bg-brand-700 px-3 py-2.5 font-bold dark:bg-brand-800">{monthLabel(month)}</td>
                  <td colSpan={SLOTS + 1} className="px-3 py-2.5 text-xs text-white/80">
                    Month total{!d.count_weekend && " · weekend days are not counted"} · each filled hour counts 1 h; points come from the task list
                  </td>
                  <td className="num px-3 py-2.5 text-right font-bold">{d.totals.hours} h</td>
                  <td className="num px-3 py-2.5 text-right font-bold">{nf.format(d.totals.points)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
