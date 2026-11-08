import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { api, errorText } from "../api/client";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from "../components/ui";

/* ---------- types ---------- */
type Key = { key: string; label: string; points?: number };
interface Settings { product: string; tagline: string; period_start: string; period_days: number; targets: Record<"points" | "leads" | "opps" | "clients", number>;
  weeks: { leads: number; opps: number; clients: number; points: number; focus: string }[]; rules: Record<string, number>;
  lists: Record<"countries" | "industries" | "channels" | "plans", string[]>; plan_template: "blank" | "centralai"; share_with_admins: boolean; stages: Key[]; milestones: Key[]; activity_types: Key[]; updated_at: string }
interface Activity { id: number; date: string; type: string; qty: number; note: string; points: number }
type M = { leads: number; opps: number; clients: number; points: number };
interface Week { n: number; from: string; to: string; leads: number; opps: number; clients: number; points: number; focus: string; actual: M; plan: { done: number; total: number } }
interface Row { key: string; prospects: number; leads: number; opps: number; clients: number }
interface Period { n: number; current: number; start: string; end: string; days: number; day_index: number }
interface Summary { today: string; period: Period; targets: M; totals: M; weeks: Week[];
  funnel: { prospects: number; contacted: number; leads: number; opps: number; clients: number }; due: { id: number; company: string; next_follow_up: string; next_action: string; overdue: boolean }[];
  due_count: number; by_country: Row[]; by_channel: Row[] }

const fmt = (s?: string | null) => (s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const longDay = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const TABS = [["pipeline", "Pipeline"], ["overview", "Overview"], ["activity", "Activity log"], ["settings", "Settings"]] as const;
// SRS v0.5 My Pipeline: the board, list and record drawer (stage stepper, deal health, Client Log).
const PipelineView = lazy(() => import("../features/pipeline/PipelineView"));
const fmtY = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Step between periods. The current period (the one today falls in) is shown unless you pick another. */
function PeriodNav({ p, set }: { p: Period; set: (n: number | null) => void }) {
  const when = p.n === p.current ? <Badge tone="green">Current</Badge> : p.n < p.current ? <Badge>Past</Badge> : <Badge tone="brand">Upcoming</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" className="px-2.5 py-1" onClick={() => set(p.n - 1)} disabled={p.n <= 0} aria-label="Previous period"><ChevronLeft className="size-4" /></Button>
      <span className="num text-sm font-semibold">{fmt(p.start)} – {fmtY(p.end)}</span>{when}
      <Button variant="secondary" className="px-2.5 py-1" onClick={() => set(p.n + 1)} aria-label="Next period"><ChevronRight className="size-4" /></Button>
      {p.n !== p.current && <Button variant="ghost" className="py-1" onClick={() => set(null)}>Back to this period</Button>}
    </div>
  );
}

/* ---------- overview ---------- */
function Overview({ s, go, setPeriod }: { s: Summary; go: (tab: string, id?: number) => void; setPeriod: (n: number | null) => void }) {
  const p = s.period, f = s.funnel;
  const cards = (["points", "leads", "opps", "clients"] as const).map((k) => {
    const v = s.totals[k], t = Number(s.targets[k] || 0), exp = (t * p.day_index) / p.days;
    const pace = !t ? "No target set" : v >= t ? "Target reached" : p.day_index === 0 ? `Counting starts ${fmt(p.start)}` : v >= exp ? "On pace" : `Behind pace by ${nf.format(exp - v)}`;
    return { k, v, t, pace, good: !!t && (v >= t || v >= exp) };
  });
  return (
    <div className="grid gap-6">
      <PeriodNav p={p} set={setPeriod} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.k} className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{c.k === "opps" ? "Opportunities" : c.k}</div>
            <div className="mt-2 flex items-baseline gap-2"><span className="num text-3xl">{nf.format(c.v)}</span><span className="text-sm text-slate-500">of {nf.format(c.t)}</span></div>
            <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div className={clsx("h-full rounded-full", c.v >= c.t && c.t ? "bg-leaf-500" : "bg-brand-600 dark:bg-brand-300")} style={{ width: `${c.t ? Math.min(100, (c.v / c.t) * 100) : 0}%` }} />
              {p.day_index > 0 && p.day_index < p.days && <div className="absolute inset-y-0 w-0.5 bg-accent-500" style={{ left: `${(p.day_index / p.days) * 100}%` }} title="Where you should be today" />}
            </div>
            <div className={clsx("mt-2 text-xs", c.good ? "text-leaf-600" : c.t ? "text-accent-600" : "text-slate-500")}>{c.pace}</div>
          </Card>
        ))}
      </div>
      <Card className="grid grid-cols-2 overflow-hidden sm:grid-cols-5 sm:divide-x sm:divide-slate-200 dark:sm:divide-white/10">
        {([["Prospects", f.prospects, "in your list"], ["Contacted", f.contacted, `${pct(f.contacted, f.prospects)} of prospects`], ["Leads", f.leads, `${pct(f.leads, f.contacted)} reply rate`],
          ["Opportunities", f.opps, `${pct(f.opps, f.leads)} of leads`], ["Clients", f.clients, `${pct(f.clients, f.opps)} of opps`]] as const).map(([l, v, c]) => (
          <div key={l} className="p-4"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{l}</div><div className="num text-2xl">{v}</div><div className="text-xs text-slate-500">{c}</div></div>
        ))}
      </Card>
      {s.due_count > 0 && (
        <Card className="border-l-4 border-l-amber-500 p-5">
          <h2 className="text-base font-bold">Follow-ups due · {s.due_count}</h2>
          <ul className="mt-3 space-y-1.5 text-sm">{s.due.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-3">
              <span className={clsx("num w-32 text-xs font-semibold", d.overdue ? "text-accent-600" : "text-amber-600")}>{d.overdue ? `Overdue · ${fmt(d.next_follow_up)}` : "Today"}</span>
              <button type="button" className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-200" onClick={() => go("pipeline", d.id)}>{d.company}</button>
              <span className="text-slate-500">{d.next_action || "Follow up"}</span>
            </li>))}</ul>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <div className="px-5 pt-5"><h2 className="text-base font-bold">Weekly report</h2><p className="text-xs text-slate-500">Each cell is actual / target. A lead, opportunity or client counts in the week its stage date falls in.</p></div>
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
            {["Week", "Dates", "Leads", "Opps", "Clients", "Points"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {s.weeks.map((w) => {
              const c = (a: number, t: number) => <td className={clsx("num px-4 py-2", t > 0 && a >= t && "font-semibold text-leaf-600")}>{nf.format(a)} / {nf.format(t)}</td>;
              return <tr key={w.n} className="border-b border-slate-100 dark:border-white/5"><td className="px-4 py-2"><b>Week {w.n}</b><div className="text-xs text-slate-500">{w.focus}</div></td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmt(w.from)} – {fmt(w.to)}</td>{c(w.actual.leads, w.leads)}{c(w.actual.opps, w.opps)}{c(w.actual.clients, w.clients)}{c(w.actual.points, w.points)}</tr>;
            })}
            <tr className="bg-brand-50 font-semibold dark:bg-brand-400/10"><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-xs">{fmt(p.start)} – {fmt(p.end)}</td>
              {(["leads", "opps", "clients", "points"] as const).map((k) => <td key={k} className="num px-4 py-2">{nf.format(s.totals[k])} / {nf.format(Number(s.targets[k] || 0))}</td>)}</tr>
          </tbody>
        </table>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        {([["Results by market", s.by_country], ["Results by channel", s.by_channel]] as const).map(([title, rows]) => (
          <Card key={title} className="overflow-x-auto"><div className="px-5 pt-5"><h2 className="text-base font-bold">{title}</h2></div>
            <table className="mt-3 w-full text-sm"><thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              {["", "Prospects", "Leads", "Opps", "Clients", "Lead → client"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr></thead>
              <tbody>{rows.length ? rows.map((r) => <tr key={r.key} className="border-b border-slate-100 dark:border-white/5"><td className="px-4 py-2">{r.key}</td>
                {[r.prospects, r.leads, r.opps, r.clients].map((v, i) => <td key={i} className="num px-4 py-2">{v}</td>)}<td className="num px-4 py-2">{pct(r.clients, r.leads)}</td></tr>)
                : <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Add prospects to see this.</td></tr>}</tbody></table>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- activity ---------- */
function ActivityLog({ st }: { st: Settings }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["tracker", "activities"], queryFn: async () => (await api.get<Activity[]>("/tracker/activities/")).data });
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), type: st.activity_types[0]?.key ?? "email", qty: "1", note: "" });
  const add = useMutation({ mutationFn: async () => (await api.post("/tracker/activities/", { ...f, qty: Math.max(1, +f.qty || 1) })).data,
    onSuccess: () => { setF({ ...f, qty: "1", note: "" }); qc.invalidateQueries({ queryKey: ["tracker"] }); } });
  const del = useMutation({ mutationFn: async (id: number) => api.delete(`/tracker/activities/${id}/`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tracker"] }) });
  const label = (k: string) => st.activity_types.find((a) => a.key === k)?.label ?? k;
  const byDay = new Map<string, Activity[]>();
  (list.data ?? []).forEach((a) => byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]));
  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="grid gap-3 sm:grid-cols-[10rem_1fr_6rem_2fr_auto] sm:items-end">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="Activity"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{st.activity_types.map((a) => <option key={a.key} value={a.key}>{a.label} · {a.points} pts</option>)}</Select></Field>
          <Field label="Quantity"><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className="num" /></Field>
          <Field label="Note (optional)"><Input value={f.note} maxLength={300} placeholder="e.g. UAE real estate batch, 4 replies" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <Button type="submit" busy={add.isPending}>Log activity</Button>
        </form>
        {add.error && <div className="mt-3"><Alert>{errorText(add.error)}</Alert></div>}
      </Card>
      {!byDay.size ? <Card><EmptyState title="No activity logged yet">At the end of each day, log what you did, for example "Cold email sent × 30". Points come from your point rules.</EmptyState></Card>
        : [...byDay.entries()].map(([day, items]) => (
          <div key={day}><h3 className="mb-2 text-sm font-bold">{longDay(day)} · <span className="num text-brand-700 dark:text-brand-200">{nf.format(items.reduce((s, a) => s + a.points, 0))} pts</span></h3>
            <Card className="overflow-x-auto"><table className="w-full text-sm"><tbody>{items.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-white/5"><td className="px-4 py-2">{label(a.type)}</td><td className="num px-4 py-2">× {a.qty}</td>
                <td className="num px-4 py-2">{nf.format(a.points)} pts</td><td className="px-4 py-2 text-xs text-slate-500">{a.note}</td>
                <td className="px-4 py-2 text-right"><Button variant="ghost" className="py-1" onClick={() => del.mutate(a.id)}>Remove</Button></td></tr>))}</tbody></table></Card></div>))}
    </div>
  );
}

/* ---------- settings ---------- */
function TrackerSettings({ st }: { st: Settings }) {
  const qc = useQueryClient();
  const [f, setF] = useState(st);
  const [listsText, setListsText] = useState(Object.fromEntries(Object.entries(st.lists).map(([k, v]) => [k, v.join("\n")])) as Record<keyof Settings["lists"], string>);
  const nWeeks = Math.max(1, Math.floor(f.period_days / 7));
  const weeks = Array.from({ length: nWeeks }, (_, i) => f.weeks[i] ?? { leads: 0, opps: 0, clients: 0, points: 0, focus: "" });
  const save = useMutation({
    mutationFn: async () => (await api.patch<Settings>("/tracker/settings/", { product: f.product, tagline: f.tagline, period_start: f.period_start, period_days: f.period_days,
      targets: f.targets, weeks, rules: f.rules, plan_template: f.plan_template, share_with_admins: f.share_with_admins,
      lists: Object.fromEntries(Object.entries(listsText).map(([k, v]) => [k, v.split("\n").map((x) => x.trim()).filter(Boolean)])) })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tracker"] }),
  });
  const backup = useRef<HTMLInputElement>(null);
  const imp = useMutation({
    mutationFn: async (file: File) => { const b = new FormData(); b.append("file", file); return (await api.post<{ prospects: number; activities: number; plan_days: number }>("/tracker/import-backup/", b)).data; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tracker"] }),
  });
  const setWeek = (i: number, k: string, v: string) => { const w = [...weeks]; w[i] = { ...w[i], [k]: k === "focus" ? v : +v || 0 }; setF({ ...f, weeks: w }); };
  const section = (title: string, children: ReactNode, sub?: string) => (
    <Card className="p-5"><h2 className="text-base font-bold">{title}</h2>{sub && <p className="mb-1 text-xs text-slate-500">{sub}</p>}<div className="mt-3">{children}</div></Card>);
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-6">
      {section("Product and period", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Product you sell"><Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="e.g. Central AI" /></Field>
        <Field label="Tagline"><Input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} placeholder="e.g. International Business Development" /></Field>
        <Field label="Period starts"><Input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} required /></Field>
        <Field label="Length (days)"><Input type="number" min={7} max={120} value={f.period_days} onChange={(e) => setF({ ...f, period_days: +e.target.value || 30 })} /></Field>
        {(["points", "leads", "opps", "clients"] as const).map((k) => <Field key={k} label={`Target: ${k === "opps" ? "opportunities" : k}`}><Input type="number" min={0} className="num" value={f.targets[k] ?? 0}
          onChange={(e) => setF({ ...f, targets: { ...f.targets, [k]: +e.target.value || 0 } })} /></Field>)}
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={f.share_with_admins} onChange={(e) => setF({ ...f, share_with_admins: e.target.checked })} />
          <span><b>Share my pipeline with admins.</b> They can see your prospects and funnel (read-only) on their Team pipelines page. Off = only you can see it.</span></label>
      </div>, "The period repeats on its own. A start on the 1st with 28–31 days runs month by month; anything else repeats every set number of days. Weekly targets follow it.")}
      {section("Weekly targets", <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
        {["Week", "Leads", "Opps", "Clients", "Points", "Focus"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead>
        <tbody>{weeks.map((w, i) => <tr key={i}><td className="px-2 py-1 font-semibold">Week {i + 1}</td>
          {(["leads", "opps", "clients", "points"] as const).map((k) => <td key={k} className="px-2 py-1"><Input type="number" min={0} className="num w-20" value={w[k]} onChange={(e) => setWeek(i, k, e.target.value)} /></td>)}
          <td className="px-2 py-1"><Input value={w.focus} onChange={(e) => setWeek(i, "focus", e.target.value)} /></td></tr>)}</tbody></table></div>)}
      {section("Point rules", <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[...st.milestones, ...st.activity_types].map((r) => (
        <label key={r.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-white/10"><span>{r.label}</span>
          <input type="number" min={0} step={0.1} value={f.rules[r.key] ?? r.points} onChange={(e) => setF({ ...f, rules: { ...f.rules, [r.key]: +e.target.value } })}
            className="num w-20 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-right dark:border-white/15" aria-label={`Points for ${r.label}`} /></label>))}</div>,
        "Milestones give points when a prospect first reaches that stage; activities give points per unit.")}
      {section("Lists", <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{(["countries", "industries", "channels", "plans"] as const).map((k) => (
        <Field key={k} label={k === "plans" ? "Product plans" : k[0].toUpperCase() + k.slice(1)} hint="One per line">
          <Textarea className="min-h-36" value={listsText[k]} onChange={(e) => setListsText({ ...listsText, [k]: e.target.value })} /></Field>))}</div>)}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" busy={save.isPending}>Save settings</Button>{save.isSuccess && <span className="text-sm text-leaf-600" role="status">Saved</span>}
        {save.error && <Alert>{errorText(save.error)}</Alert>}</div>
      {section("Bring in your old tracker", <div className="flex flex-wrap items-center gap-3">
        <input ref={backup} type="file" accept=".json,application/json" className="sr-only" aria-label="Old tracker backup file"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) imp.mutate(file); }} />
        <Button type="button" variant="secondary" onClick={() => backup.current?.click()} busy={imp.isPending}><Upload className="size-4" /> Choose backup (.json)</Button>
        {imp.data && <Alert tone="green">Brought in {imp.data.prospects} prospects, {imp.data.activities} activities and {imp.data.plan_days} plan days.</Alert>}
        {imp.error && <Alert>{errorText(imp.error)}</Alert>}</div>,
        "In the old single-page tracker, use Settings → Download backup, then choose that file here. Prospects already here are skipped.")}
    </form>
  );
}

export default function Tracker() {
  const settings = useQuery({ queryKey: ["tracker", "settings"], queryFn: async () => (await api.get<Settings>("/tracker/settings/")).data });
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "pipeline";
  const [openId, setOpenId] = useState<number | null>(null);
  const [period, setPeriod] = useState<number | null>(null);   // null = the period today falls in
  const summary = useQuery({ queryKey: ["tracker", "summary", period], placeholderData: (prev) => prev, enabled: tab === "overview",
    queryFn: async () => (await api.get<Summary>("/tracker/summary/", { params: { period: period ?? undefined } })).data });
  // The daily plan moved out of the pipeline into My Day (SRS v0.5 FR-G5: My Pipeline holds pipeline records only).
  if (tab === "plan") return <Navigate to="/my-day?tab=plan" replace />;
  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <Alert>{errorText(settings.error)}</Alert>;
  const st = settings.data!;
  const go = (t: string, id?: number) => { setParams({ tab: t }, { replace: true }); if (id) setOpenId(id); };
  const clearOpen = () => setOpenId(null);
  return (
    <>
      <PageHeader title="My pipeline" subtitle={st.product ? `${st.product}${st.tagline ? ` · ${st.tagline}` : ""}` : "Your qualified leads and opportunities. Weekly KPIs are counted from the stages they reach."} />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/10" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)}
          className={clsx("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", tab === k ? "border-accent-500 text-slate-900 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")}>{l}</button>)}
      </div>
      {tab === "overview" && (summary.isLoading ? <Spinner /> : summary.data ? <Overview s={summary.data} go={go} setPeriod={setPeriod} /> : <Alert>{errorText(summary.error)}</Alert>)}
      {tab === "pipeline" && <Suspense fallback={<Spinner />}><PipelineView openId={openId} clearOpen={clearOpen} /></Suspense>}
      {tab === "activity" && <ActivityLog st={st} />}
      {tab === "settings" && <TrackerSettings key={st.updated_at} st={st} />}
    </>
  );
}
