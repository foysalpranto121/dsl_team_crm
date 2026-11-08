import { AlertTriangle, ArrowRight, Check, RefreshCw, Save, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ChartCard, ChartLegend, ChartTooltip, useChartTheme } from "@/components/data/chart";
import { Delta, StatCard } from "@/components/data/stat-card";
import { EmptyState } from "@/components/data/states";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/form-controls";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Progress, ProgressRing, toneForRatio } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money, num, signed } from "@/lib/format";
import { useLocalState } from "@/lib/use-local-state";
import { cn } from "@/lib/utils";
import {
  adherenceOf, APPROVALS, avgScore, CATEGORIES, CURRENCY, DUE_DEALS, funnelOf, INSIGHTS, METRICS, PEOPLE, PERIODS, PLAN_COVERAGE, REVENUE_BY_MONTH, ROLES, SCORE_TREND, scoreOf, SEGMENT_FUNNEL, STALE_DEALS, sumOf, targetsFor, targetSumOf,
  TODAY_SLOTS, TOP_DEVIATIONS, WEEK_DAYS, type MetricKey, type PeriodKey, type Person, type RoleKey,
} from "./mock";
import { CardTitle, Drill, pctOf, PreviewPage, sample, ScorePill, ScrollX, showMetric, SlotChips, TH, TH_NUM } from "./parts";

const OVERLOAD_AT = 10;
const roleKeys = Object.keys(ROLES) as RoleKey[];
const short = (v: number) => money(v, { compact: true, currency: null });
/** The metric that costs this person the most of their score. */
function biggestGap(p: Person, period: PeriodKey) {
  const t = targetsFor(p.role, period), w = ROLES[p.role].weights;
  return METRICS.filter((m) => w[m.key] && t[m.key]).map((m) => ({ label: m.label, lost: (w[m.key] / 100) * Math.max(0, 1 - p.actual[period][m.key] / t[m.key]) })).sort((x, y) => y.lost - x.lost)[0]?.label.toLowerCase();
}
/** The value at the end of a line, so a trend reads without hovering. */
const endLabel = (last: number, fill: string) => (p: { x?: string | number; y?: string | number; value?: unknown; index?: number }) =>
  p.index === last ? <text x={Number(p.x ?? 0) + 6} y={p.y} dy={4} fontSize={11} fill={fill}>{String(p.value)}%</text> : <g />;

type Mode = "off" | "self" | "improve" | "teams" | "peers";
const MODES: { key: Mode; label: string }[] = [{ key: "off", label: "Off" }, { key: "self", label: "Self vs target" }, { key: "improve", label: "Improvement" }, { key: "teams", label: "Team vs team" }, { key: "peers", label: "Peer ranking" }];

const MIX: Record<RoleKey, { name: string; you: number; usual: number }[]> = {
  tender: [{ name: "Proposal Preparation", you: 38, usual: 42 }, { name: "Cold Client Calling", you: 20, usual: 16 }, { name: "Client Meeting", you: 12, usual: 14 }, { name: "Lead Generation", you: 10, usual: 10 }, { name: "Sales", you: 10, usual: 10 }, { name: "Everything else", you: 10, usual: 8 }],
  product: [{ name: "Cold Client Calling", you: 34, usual: 32 }, { name: "Proposal Preparation", you: 24, usual: 26 }, { name: "Cold Client Emailing", you: 12, usual: 12 }, { name: "Client Meeting", you: 10, usual: 12 }, { name: "Sales", you: 10, usual: 10 }, { name: "Everything else", you: 10, usual: 8 }],
  ai: [{ name: "Cold Client Calling", you: 40, usual: 34 }, { name: "Proposal Preparation", you: 16, usual: 20 }, { name: "Lead Generation", you: 14, usual: 14 }, { name: "Cold Client Emailing", you: 10, usual: 10 }, { name: "Client Meeting", you: 10, usual: 14 }, { name: "Everything else", you: 10, usual: 8 }],
  marketing: [{ name: "Lead Generation", you: 52, usual: 55 }, { name: "Cold Client Emailing", you: 20, usual: 18 }, { name: "Special Assignment", you: 10, usual: 8 }, { name: "Planning & Reporting", you: 8, usual: 8 }, { name: "Product Management", you: 5, usual: 6 }, { name: "Everything else", you: 5, usual: 5 }],
};

function gapSentence(key: MetricKey, gap: number, label: string) {
  if (gap <= 0) return "You've reached this. Anything more is a bonus.";
  if (key === "hours") return `You need ${num(gap)} more output hours a week, about ${num(gap / 6, 1)} per working day.`;
  if (key === "points") return `You need ${num(gap)} more points.`;
  if (key === "revenue") return `You need ${money(gap, { compact: true, currency: CURRENCY })} more in verified wins.`;
  return `${num(gap)} more ${gap === 1 ? label.toLowerCase().replace(/s$/, "") : label.toLowerCase()} gets you to 100%.`;
}

/* ---------- FR-S5: ranking that encourages. Top N plus your own place, never a bottom list. `viewer` is null for a supervisor, who isn't on the list. ---------- */
function Standing({ viewer, mode, period, rows = PEOPLE }: { viewer: Person | null; mode: Mode; period: PeriodKey; rows?: Person[] }) {
  const change = (p: Person) => Math.round((scoreOf(p, "month") - scoreOf(p, "last")) * 100);
  if (mode === "off") return <p className="text-sm text-muted-foreground">Rankings are switched off for this team. {viewer ? "Your own numbers are below." : "Each member still sees their own numbers."}</p>;
  if (mode === "self") {
    if (!viewer) return <ul className="space-y-2">{rows.map((p) => { const s = scoreOf(p, period); return <li key={p.id}><div className="flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{p.name}</span><span className="tabular-nums">{pctOf(s)}</span></div><Progress value={s * 100} size="sm" tone={toneForRatio(s)} label={`${p.name}: ${pctOf(s)} of target`} className="mt-1" /></li>; })}</ul>;
    const mine = scoreOf(viewer, period);
    return (<><p className="text-sm">You're at <strong className="font-semibold tabular-nums">{pctOf(mine)}</strong> of your own target.</p><Progress value={mine * 100} tone={toneForRatio(mine)} label={`${viewer.name}: ${pctOf(mine)} of target`} className="mt-2" /></>);
  }
  if (mode === "improve") {
    if (!viewer) return (<><ul className="space-y-1.5">{[...rows].sort((x, y) => change(y) - change(x)).map((p) => <li key={p.id} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{p.name}</span><span className="shrink-0 text-xs"><Delta value={change(p)} text={signed(change(p), 0, " points")} label="" /></span></li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Each person against their own September.</p></>);
    return (<><p className="text-sm">Against your own last month: <span className="tabular-nums">{pctOf(scoreOf(viewer, "last"))}</span> to <span className="font-semibold tabular-nums">{pctOf(scoreOf(viewer, "month"))}</span>.</p><p className="mt-1 text-xs text-muted-foreground"><Delta value={change(viewer)} text={signed(change(viewer), 0, " points")} label="since September" /></p></>);
  }
  if (mode === "teams") {
    const groups = roleKeys.map((r) => ({ r, score: avgScore(PEOPLE.filter((p) => p.role === r), period) })).sort((x, y) => y.score - x.score);
    return (<><ol className="space-y-1.5">{groups.map((g) => <li key={g.r} className={cn("flex items-center justify-between gap-2 text-sm", g.r === viewer?.role && "font-semibold")}><span className="min-w-0 truncate">{ROLES[g.r].name}</span><span className="tabular-nums">{pctOf(g.score)}</span></li>)}</ol><p className="mt-2 text-xs text-muted-foreground">With one team today, this compares role profiles. It compares teams once you have more than one.</p></>);
  }
  const order = [...PEOPLE].sort((x, y) => scoreOf(y, period) - scoreOf(x, period));
  const place = viewer ? order.findIndex((p) => p.id === viewer.id) + 1 : 0;
  return (
    <>
      <ol className="space-y-1.5" aria-label="Top of the team">{order.slice(0, 3).map((p, i) => <li key={p.id} className={cn("flex items-center gap-2 text-sm", p.id === viewer?.id && "font-semibold")}><span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span><span className="min-w-0 flex-1 truncate">{p.id === viewer?.id ? "You" : p.name}</span><span className="tabular-nums">{pctOf(scoreOf(p, period))}</span></li>)}</ol>
      {viewer && place > 3 && <p className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold"><span>You're in place {place}</span><span className="tabular-nums">{pctOf(scoreOf(viewer, period))}</span></p>}
      <p className="mt-2 text-xs text-muted-foreground">{viewer ? "Shows the top 3 and your own place. There's no list of who's at the bottom." : "Members see the top 3 and their own place, never a bottom list. You see everyone in the scorecards below."}</p>
    </>
  );
}

/* ---------- FR-D1: member ---------- */
function MemberView({ period, mode, setMode }: { period: PeriodKey; mode: Mode; setMode: (m: Mode) => void }) {
  const [who, setWho] = useState("nadia");
  const theme = useChartTheme();
  const p = PEOPLE.find((x) => x.id === who)!;
  const a = p.actual[period], t = targetsFor(p.role, period), score = scoreOf(p, period);
  const when = PERIODS.find((x) => x.key === period)!;
  const done = TODAY_SLOTS.filter((s) => s.state === "done").length;
  const mix = MIX[p.role];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="See it as" className="w-56"><NativeSelect value={who} onChange={(e) => setWho(e.target.value)}>{PEOPLE.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
        <div><span className="label">Leaderboard mode (set per team)</span><Segmented label="Leaderboard mode" value={mode} onChange={setMode} options={MODES} /></div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card flex flex-wrap items-center gap-5 p-5" aria-label="Your Playbook">
          <ProgressRing value={done} max={TODAY_SLOTS.length} size={84} stroke={8} label={`Today: ${done} of ${TODAY_SLOTS.length} done`}><span className="text-sm font-semibold tabular-nums">{Math.round((done / TODAY_SLOTS.length) * 100)}%</span></ProgressRing>
          <div className="min-w-0 flex-1 basis-56"><p className="text-xs text-muted-foreground">Next on your Playbook</p><p className="text-base font-semibold">Send Meghna Textiles the revised price</p><p className="text-sm text-muted-foreground">Negotiation stage · due today</p></div>
          <Button asChild><Link to="/home">Open Home <ArrowRight /></Link></Button>
        </section>
        <section className="card p-5" aria-labelledby="standing-title"><h2 id="standing-title" className="mb-2 text-sm font-semibold">Your standing</h2><Standing viewer={p} mode={mode} period={period} /></section>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={period === "week" ? "Output hours, this week" : `Output hours a week, ${when.label.toLowerCase()}`} value={<Drill metric="hours" value={a.hours} who={p.name} title="Output hours">{num(a.hours)}</Drill>} target={num(t.hours)} progress={{ value: a.hours, max: t.hours, tone: toneForRatio(a.hours / t.hours) }} />
        <StatCard label={`Points, ${when.label.toLowerCase()}`} value={<Drill metric="points" value={a.points} who={p.name} title="Points">{num(a.points)}</Drill>} target={num(t.points)} progress={{ value: a.points, max: t.points, tone: toneForRatio(a.points / t.points) }} />
        <StatCard label="Composite score" value={pctOf(score)} footer={<ScorePill ratio={score} />} />
        <StatCard label="Plan adherence" value={pctOf(adherenceOf(p))} footer={`${p.adherence.completed} of ${p.adherence.approved} approved hours done`} />
      </div>
      <section className="card p-5" aria-labelledby="todays-plan-title"><h2 id="todays-plan-title" className="mb-3 text-sm font-semibold">Today's plan</h2><SlotChips slots={TODAY_SLOTS} /></section>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card overflow-hidden" aria-labelledby="gaps-title">
          <CardTitle id="gaps-title" title="Your numbers, in plain words" note={`${when.label}: ${when.of}`} />
          <ul className="divide-y divide-border">{METRICS.map((m) => {
            const scored = ROLES[p.role].weights[m.key] > 0 && t[m.key] > 0, r = t[m.key] ? a[m.key] / t[m.key] : 0;
            return (
              <li key={m.key} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="text-sm font-semibold">{m.label}</span>
                  <span className="flex items-center gap-2 text-sm tabular-nums"><span><Drill metric={m.key} value={a[m.key]} who={p.name} title={m.label}>{showMetric(m.key, a[m.key])}</Drill>{scored && <span className="text-muted-foreground"> of {showMetric(m.key, t[m.key])}</span>}</span>{scored && <ScorePill ratio={r} />}</span></div>
                {scored ? <><Progress value={r * 100} size="sm" tone={toneForRatio(r)} label={`${m.label}: ${pctOf(r)} of target`} className="mt-2" /><p className="mt-1.5 text-sm">{gapSentence(m.key, t[m.key] - a[m.key], m.label)}</p></> : <p className="mt-1 text-xs text-muted-foreground">Shown for information. It doesn't count towards your role's score.</p>}
              </li>);
          })}</ul>
        </section>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <section className="card overflow-hidden" aria-labelledby="due-title">
            <CardTitle id="due-title" title="Pipeline due" />
            <ul className="divide-y divide-border">{DUE_DEALS.map((d) => <li key={d.company} className="px-5 py-3"><div className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="text-sm font-medium">{d.company}</span><span className="text-xs text-muted-foreground">{d.when}</span></div><p className="text-sm text-muted-foreground">{d.next} · {d.stage}</p></li>)}</ul>
          </section>
          <ChartCard title="Category mix" description="Your share of hours against your role's." height={260}
            legend={<ChartLegend items={[{ name: "You", color: theme.series[0] }, { name: "Your role", color: theme.series[1] }]} />} table={{ columns: ["Category", "You", "Your role"], rows: mix.map((m) => [m.name, `${m.you}%`, `${m.usual}%`]) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mix} layout="vertical" margin={{ left: 0, right: 12 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke={theme.grid} /><XAxis type="number" {...theme.axis} unit="%" /><YAxis type="category" dataKey="name" {...theme.axis} width={124} tick={{ ...theme.axis.tick, fontSize: 11 }} />
                <Tooltip content={<ChartTooltip format={(v) => `${v}%`} />} cursor={theme.cursor} />
                <Bar isAnimationActive={false} dataKey="you" name="You" fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={10} /><Bar isAnimationActive={false} dataKey="usual" name="Your role" fill={theme.series[1]} radius={[0, 4, 4, 0]} maxBarSize={10} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

/* ---------- FR-D2: supervisor ---------- */
function MemberSheet({ p, period, onClose }: { p: Person | null; period: PeriodKey; onClose: () => void }) {
  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>{p?.name}</SheetTitle><SheetDescription>{p && ROLES[p.role].name}</SheetDescription></SheetHeader>
        <SheetBody>{p && (
          <>
            <div className="flex items-center gap-3"><ProgressRing value={Math.min(100, scoreOf(p, period) * 100)} size={72} stroke={7} tone={toneForRatio(scoreOf(p, period))} label={`Score ${pctOf(scoreOf(p, period))}`}><span className="text-xs font-semibold tabular-nums">{pctOf(scoreOf(p, period))}</span></ProgressRing><div><div className="text-xs text-muted-foreground">Composite score</div><ScorePill ratio={scoreOf(p, period)} /></div></div>
            <h3 className="mt-4 text-sm font-semibold">Numbers</h3>
            <ul className="mt-1 divide-y divide-border text-sm">{METRICS.filter((m) => targetsFor(p.role, period)[m.key]).map((m) => <li key={m.key} className="flex justify-between gap-3 py-2"><span>{m.label}</span><span className="tabular-nums">{showMetric(m.key, p.actual[period][m.key])} <span className="text-muted-foreground">of {showMetric(m.key, targetsFor(p.role, period)[m.key])}</span></span></li>)}</ul>
            <h3 className="mt-4 text-sm font-semibold">Today</h3><SlotChips slots={TODAY_SLOTS} className="mt-2 sm:grid-cols-2" />
          </>)}</SheetBody>
        <SheetFooter><Button onClick={() => p && sample(`This opens ${p.name}'s day`)}>Open {p?.name.split(" ")[0]}'s day</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function CategoryAnalysis({ scale }: { scale: number }) {
  const theme = useChartTheme();
  const [by, setBy] = useState<"hours" | "points">("hours");
  const rows = CATEGORIES.map((c) => ({ ...c, hours: Math.round(c.hours * scale), points: Math.round(c.points * scale) }));
  const total = rows.reduce((s, c) => s + c.hours, 0);
  return (
    <ChartCard title="Category analysis" description="Where the month's effort went. The table view adds each category's share against the expected mix." height={360} className="lg:col-span-2"
      actions={<Segmented label="Show" value={by} onChange={setBy} options={[{ key: "hours", label: "Hours" }, { key: "points", label: "Points" }]} />}
      table={{ columns: ["Category", "Hours", "Share", "Expected", "Points"], rows: rows.map((c) => [c.name, c.hours, pctOf(total ? c.hours / total : 0), `${c.expected}%`, c.points]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 36 }}>
          <CartesianGrid horizontal={false} stroke={theme.grid} /><XAxis type="number" {...theme.axis} /><YAxis type="category" dataKey="name" {...theme.axis} width={134} tick={{ ...theme.axis.tick, fontSize: 11 }} interval={0} />
          <Tooltip content={<ChartTooltip />} cursor={theme.cursor} />
          <Bar isAnimationActive={false} dataKey={by} name={by === "hours" ? "Hours" : "Points"} fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={14}><LabelList dataKey={by} position="right" fill={theme.muted} fontSize={11} /></Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SupervisorView({ rows, period, mode, setMode }: { rows: Person[]; period: PeriodKey; mode: Mode; setMode: (m: Mode) => void }) {
  const theme = useChartTheme();
  const [queue, setQueue] = useState(APPROVALS);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<Person | null>(null);
  const planned = WEEK_DAYS.reduce((s, d) => s + d.planned, 0), actual = WEEK_DAYS.reduce((s, d) => s + d.actual, 0);
  const atRisk = rows.filter((p) => scoreOf(p, period) < 0.8), overloaded = rows.filter((p) => p.overdue > OVERLOAD_AT);
  const attention = rows.filter((p) => atRisk.includes(p) || overloaded.includes(p));
  const funnel = funnelOf(rows, period === "week" ? "month" : period);
  const decide = (ids: string[]) => { setQueue(queue.filter((a) => !ids.includes(a.id))); setPicked([]); sample(`${ids.length} approved`); };
  const scale = rows.reduce((s, p) => s + p.actual.month.hours, 0) / PEOPLE.reduce((s, p) => s + p.actual.month.hours, 0);
  if (!rows.length) return <div className="card"><EmptyState title="Nobody matches these filters">Try a different role profile or person.</EmptyState></div>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Approvals due" value={queue.length} footer={queue.some((a) => a.late) ? <StatusPill status="warning">1 past its window</StatusPill> : "All within the window"} />
        <StatCard label="Plan coverage" value={pctOf(PLAN_COVERAGE.planned / PLAN_COVERAGE.target)} footer={`${PLAN_COVERAGE.planned} of ${PLAN_COVERAGE.target} target hours planned this week`} />
        <StatCard label="Planned vs actual" value={num(actual)} unit="h" target={`${num(planned)} h`} progress={{ value: actual, max: planned }} footer={pctOf(actual / planned)} />
        <StatCard label="Need a look" value={attention.length} footer={`${atRisk.length} at risk, ${overloaded.length} overloaded`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card overflow-hidden" aria-labelledby="queue-title">
          <CardTitle id="queue-title" title="Approvals queue" action={<Button size="sm" disabled={!picked.length} onClick={() => decide(picked)}><Check /> Approve selected{picked.length ? ` · ${picked.length}` : ""}</Button>} />
          {queue.length ? <ul className="divide-y divide-border">{queue.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3"><Checkbox className="mt-1" aria-label={`Select ${a.kind.toLowerCase()} from ${a.who}`} checked={picked.includes(a.id)} onCheckedChange={(c) => setPicked(c ? [...picked, a.id] : picked.filter((x) => x !== a.id))} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-medium">{a.who}</span><Badge tone="outline">{a.kind}</Badge>{a.late && <StatusPill status="warning">Past its window</StatusPill>}<span className="ml-auto text-xs tabular-nums text-muted-foreground">{a.waited}</span></div><p className="mt-0.5 text-sm text-muted-foreground">{a.what}</p></div></li>))}</ul>
            : <EmptyState compact title="All decided">New plans and deviations show up here.</EmptyState>}
        </section>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <section className="card overflow-hidden" aria-labelledby="attention-title">
            <CardTitle id="attention-title" title="At risk and overloaded" note="For you, to offer help. Members don't see this list." />
            <ul className="divide-y divide-border">
              {attention.map((p) => <li key={p.id} className="flex items-start gap-3 px-5 py-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.name}</p>{atRisk.includes(p) && <p className="text-sm text-muted-foreground">At {pctOf(scoreOf(p, period))}. Biggest gap: {biggestGap(p, period)}.</p>}{overloaded.includes(p) && <p className="text-sm text-muted-foreground">{p.overdue} overdue items, so new steps are waiting.</p>}</div><Button size="sm" variant="ghost" aria-label={`Open ${p.name}`} onClick={() => setOpen(p)}>Open</Button></li>)}
              {!attention.length && <li className="px-5 py-4 text-sm text-muted-foreground">Nobody needs a look right now.</li>}
            </ul>
          </section>
          <section className="card p-5" aria-labelledby="lb-title">
            <h2 id="lb-title" className="text-sm font-semibold">Leaderboard</h2>
            <Field label="Mode, set per team" className="my-2"><NativeSelect value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</NativeSelect></Field>
            <Standing viewer={null} mode={mode} period={period} rows={rows} />
          </section>
        </div>
      </div>
      <section className="card overflow-hidden" aria-labelledby="cards-title">
        <CardTitle id="cards-title" title="Member scorecards" note="Open a name for that person's day. Any underlined number opens its entries." />
        <ScrollX label="Member scorecards table">
          <table className="w-full min-w-[52rem] text-sm">
            <thead><tr className="border-b border-border">{["Person"].map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}{METRICS.map((m) => <th key={m.key} scope="col" className={TH_NUM}>{m.label}</th>)}<th scope="col" className={TH_NUM}>Adherence</th><th scope="col" className={TH_NUM}>Score</th><th scope="col" className={TH}>Status</th></tr></thead>
            <tbody className="tabular-nums">{rows.map((p) => (
              <tr key={p.id} className="border-b border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium"><button type="button" onClick={() => setOpen(p)} className="whitespace-nowrap rounded-sm text-primary-text hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">{p.name}</button></th>
                {METRICS.map((m) => <td key={m.key} className="whitespace-nowrap px-3 py-2 text-right"><Drill metric={m.key} value={p.actual[period][m.key]} who={p.name} title={m.label}>{showMetric(m.key, p.actual[period][m.key])}</Drill></td>)}
                <td className="px-3 py-2 text-right">{pctOf(adherenceOf(p))}</td><td className="px-3 py-2 text-right font-semibold">{pctOf(scoreOf(p, period))}</td><td className="px-3 py-2"><ScorePill ratio={scoreOf(p, period)} /></td>
              </tr>))}</tbody>
            <tfoot className="tabular-nums"><tr className="bg-muted/50"><th scope="row" className="px-3 py-2 text-left font-semibold">Team</th>{METRICS.map((m) => <td key={m.key} data-total={m.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold">{m.key === "hours" ? `${num(sumOf(rows, period, "hours") / rows.length)} avg` : showMetric(m.key, sumOf(rows, period, m.key))}</td>)}<td /><td className="px-3 py-2 text-right font-semibold">{pctOf(avgScore(rows, period))}</td><td className="px-3 py-2"><ScorePill ratio={avgScore(rows, period)} /></td></tr></tfoot>
          </table>
        </ScrollX>
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <ChartCard title="Planned vs actual" description="Hours this week, day by day." legend={<ChartLegend items={[{ name: "Planned", color: theme.series[0] }, { name: "Actual", color: theme.series[1] }]} />}
          table={{ columns: ["Day", "Planned", "Actual"], rows: WEEK_DAYS.map((d) => [d.day, d.planned, d.actual]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={WEEK_DAYS} margin={{ left: -20, right: 8 }} barGap={2}><CartesianGrid {...theme.gridProps} /><XAxis dataKey="day" {...theme.axis} /><YAxis {...theme.axis} /><Tooltip content={<ChartTooltip format={(v) => `${v} h`} />} cursor={theme.cursor} />
              <Bar isAnimationActive={false} dataKey="planned" name="Planned" fill={theme.series[0]} {...theme.bar} /><Bar isAnimationActive={false} dataKey="actual" name="Actual" fill={theme.series[1]} {...theme.bar} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Team funnel" description="Records that reached each stage this month." table={{ columns: ["Stage", "Records"], rows: funnel.map((f) => [f.stage, f.value]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnel} layout="vertical" margin={{ left: 0, right: 32 }}><XAxis type="number" hide /><YAxis type="category" dataKey="stage" {...theme.axis} width={150} tick={{ ...theme.axis.tick, fontSize: 11 }} interval={0} /><Tooltip content={<ChartTooltip />} cursor={theme.cursor} />
              <Bar isAnimationActive={false} dataKey="value" name="Records" fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={18}><LabelList dataKey="value" position="right" fill={theme.muted} fontSize={12} /></Bar></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <CategoryAnalysis scale={scale} />
      </div>
      <section className="card overflow-hidden" aria-labelledby="stale-title">
        <CardTitle id="stale-title" title="Stale pipeline" note="Longest past their expected days, each with a suggested fix." />
        <ul className="divide-y divide-border">{STALE_DEALS.filter((d) => rows.some((p) => p.name === d.who)).map((d) => (
          <li key={d.company} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3"><div className="min-w-0 flex-1 basis-64"><p className="text-sm font-medium">{d.company} <span className="font-normal text-muted-foreground">· {d.who} · {d.stage}</span></p><p className="text-sm text-muted-foreground">{d.fix}</p></div><StatusPill status="warning"><span className="tabular-nums">{d.days} days, expected {d.expected}</span></StatusPill></li>))}</ul>
      </section>
      <MemberSheet p={open} period={period} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ---------- FR-D3: management ---------- */
function Insight({ text, evidence, action }: { text: string; evidence: string; action: string }) {
  const [said, setSaid] = useState<"useful" | "not" | null>(null);
  return (
    <li className="px-5 py-3">
      <p className="text-sm">{text}</p><p className="mt-0.5 text-xs text-muted-foreground">Evidence: {evidence}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5"><Button size="sm" variant="secondary" onClick={() => sample("This opens the entries behind it")}>{action}</Button>
        <Button size="sm" variant="ghost" aria-pressed={said === "useful"} onClick={() => setSaid("useful")}><ThumbsUp /> Useful</Button><Button size="sm" variant="ghost" aria-pressed={said === "not"} onClick={() => setSaid("not")}><ThumbsDown /> Not useful</Button>
        {said && <span className="text-xs text-muted-foreground" role="status">Thanks, noted.</span>}</div>
    </li>
  );
}

function ManagementView({ rows, period, onDrill }: { rows: Person[]; period: PeriodKey; onDrill: (r: RoleKey) => void }) {
  const theme = useChartTheme();
  const rev = sumOf(rows, period, "revenue"), revT = targetSumOf(rows, period, "revenue"), clients = sumOf(rows, period, "clients"), clientsT = targetSumOf(rows, period, "clients");
  const groups = roleKeys.map((r) => ({ r, people: PEOPLE.filter((p) => p.role === r) })).filter((g) => rows.some((p) => p.role === g.r));
  const scatter = rows.map((p) => ({ name: p.name.split(" ")[0], hours: p.actual.month.hours, score: Math.round(scoreOf(p, "month") * 100) }));
  const roleNames = roleKeys.map((r) => ROLES[r].name);
  const maxDev = TOP_DEVIATIONS[0].count;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={showMetric("revenue", rev)} target={showMetric("revenue", revT)} progress={{ value: rev, max: revT || 1, tone: toneForRatio(rev / (revT || 1)) }} />
        <StatCard label="Clients" value={clients} target={clientsT} progress={{ value: clients, max: clientsT || 1, tone: toneForRatio(clients / (clientsT || 1)) }} />
        <StatCard label="Average score" value={pctOf(avgScore(rows, period))} footer={<ScorePill ratio={avgScore(rows, period)} />} />
        <StatCard label="Output hours a week" value={num(sumOf(rows, period, "hours") / (rows.length || 1))} unit="each" target={num(targetsFor("ai", period).hours)} />
      </div>
      <section className="card overflow-hidden" aria-labelledby="compare-title">
        <CardTitle id="compare-title" title="Comparison" note="With one team today, this compares role profiles. It compares teams once you have more than one." />
        <ScrollX label="Comparison by role profile">
          <table className="w-full min-w-[46rem] text-sm">
            <thead><tr className="border-b border-border"><th scope="col" className={TH}>Role profile</th><th scope="col" className={TH_NUM}>People</th><th scope="col" className={TH_NUM}>Hours a week</th><th scope="col" className={TH_NUM}>Clients</th><th scope="col" className={TH_NUM}>Revenue</th><th scope="col" className={TH_NUM}>Of target</th><th scope="col" className={TH_NUM}>Score</th><th scope="col" className={TH}>Status</th><th scope="col" className={TH}><span className="sr-only">Action</span></th></tr></thead>
            <tbody className="tabular-nums">{groups.map(({ r, people }) => {
              const t = targetSumOf(people, period, "revenue"), v = sumOf(people, period, "revenue"), s = avgScore(people, period);
              return (<tr key={r} className="border-b border-border last:border-0"><th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">{ROLES[r].name}</th><td className="px-3 py-2 text-right">{people.length}</td><td className="px-3 py-2 text-right">{num(sumOf(people, period, "hours") / people.length)}</td><td className="px-3 py-2 text-right">{sumOf(people, period, "clients")}</td><td className="whitespace-nowrap px-3 py-2 text-right">{showMetric("revenue", v)}</td><td className="px-3 py-2 text-right">{t ? pctOf(v / t) : "—"}</td><td className="px-3 py-2 text-right font-semibold">{pctOf(s)}</td><td className="px-3 py-2"><ScorePill ratio={s} /></td><td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => onDrill(r)}>Drill in <ArrowRight /></Button></td></tr>);
            })}</tbody>
          </table>
        </ScrollX>
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <ChartCard title="Score trend" description="Average composite score by role profile, last six months." legend={<ChartLegend items={roleNames.map((name, i) => ({ name, color: theme.series[i], kind: "line" as const }))} />}
          table={{ columns: ["Month", ...roleNames], rows: SCORE_TREND.map((m) => [m.month, ...roleNames.map((n) => `${m[n]}%`)]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={SCORE_TREND} margin={{ left: -16, right: 42, top: 4 }}><CartesianGrid {...theme.gridProps} /><XAxis dataKey="month" {...theme.axis} /><YAxis {...theme.axis} unit="%" domain={[30, 120]} ticks={[30, 60, 90, 120]} /><Tooltip content={<ChartTooltip format={(v) => `${v}%`} />} />
              {roleNames.map((name, i) => <Line key={name} type="monotone" dataKey={name} stroke={theme.series[i]} {...theme.line} isAnimationActive={false} label={endLabel(SCORE_TREND.length - 1, theme.muted)} />)}</LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Revenue vs target" description="Verified wins each month, against the team's target." legend={<ChartLegend items={[{ name: "Revenue", color: theme.series[0] }, { name: "Target", color: theme.series[1], kind: "line" }]} />}
          table={{ columns: ["Month", "Revenue", "Target"], rows: REVENUE_BY_MONTH.map((m) => [m.month, money(m.actual, { compact: true }), money(m.target, { compact: true })]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={REVENUE_BY_MONTH} margin={{ left: -8, right: 12, top: 4 }}><CartesianGrid {...theme.gridProps} /><XAxis dataKey="month" {...theme.axis} /><YAxis {...theme.axis} tickFormatter={short} /><Tooltip content={<ChartTooltip format={(v) => money(v, { compact: true })} />} cursor={theme.cursor} />
              <Bar isAnimationActive={false} dataKey="actual" name="Revenue" fill={theme.series[0]} {...theme.bar} /><Line type="monotone" dataKey="target" name="Target" stroke={theme.series[1]} {...theme.line} isAnimationActive={false} /></ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Funnel by segment" description="Records that reached each stage this month." legend={<ChartLegend items={["Qualified", "Requirements", "Proposal", "Won"].map((name, i) => ({ name, color: theme.series[i] }))} />}
          table={{ columns: ["Segment", "Qualified", "Requirements", "Proposal", "Won"], rows: SEGMENT_FUNNEL.map((s) => [s.segment, s.qualified, s.requirements, s.proposal, s.won]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SEGMENT_FUNNEL} margin={{ left: -20, right: 8 }} barGap={2}><CartesianGrid {...theme.gridProps} /><XAxis dataKey="segment" {...theme.axis} /><YAxis {...theme.axis} /><Tooltip content={<ChartTooltip />} cursor={theme.cursor} />
              {(["qualified", "requirements", "proposal", "won"] as const).map((k, i) => <Bar key={k} isAnimationActive={false} dataKey={k} name={k[0].toUpperCase() + k.slice(1)} fill={theme.series[i]} {...theme.bar} maxBarSize={16} />)}</BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Hours vs outcome" description="Each dot is a person, this month." table={{ columns: ["Person", "Hours a week", "Score"], rows: scatter.map((s) => [s.name, s.hours, `${s.score}%`]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: -8, right: 28, top: 12, bottom: 4 }}><CartesianGrid stroke={theme.grid} /><XAxis type="number" dataKey="hours" name="Hours a week" domain={[20, 45]} ticks={[20, 25, 30, 35, 40, 45]} {...theme.axis} unit=" h" /><YAxis type="number" dataKey="score" name="Score" domain={[0, 120]} {...theme.axis} unit="%" /><ZAxis range={[90, 90]} /><Tooltip content={<ChartTooltip />} cursor={false} />
              <Scatter data={scatter} fill={theme.series[0]} isAnimationActive={false}><LabelList dataKey="name" position="top" fill={theme.muted} fontSize={11} /></Scatter></ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden" aria-labelledby="dev-title">
          <CardTitle id="dev-title" title="Top deviations" note="What people did in place of what they planned." />
          <ul className="divide-y divide-border">{TOP_DEVIATIONS.map((d) => <li key={d.from + d.to} className="px-5 py-3"><div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0">{d.from} <ArrowRight className="inline size-3.5 text-muted-foreground" aria-label="replaced by" /> {d.to}</span><span className="font-semibold tabular-nums">{d.count}</span></div><Progress value={d.count} max={maxDev} size="sm" label={`${d.count} times`} className="mt-1.5" /></li>)}</ul>
        </section>
        <section className="card overflow-hidden" aria-labelledby="ai-title">
          <CardTitle id="ai-title" title="AI insight" action={<Badge tone="outline"><Sparkles aria-hidden />Rules on your numbers</Badge>} />
          <ul className="divide-y divide-border">{INSIGHTS.map((i) => <Insight key={i.id} text={i.text} evidence={i.evidence} action={i.to} />)}</ul>
        </section>
      </div>
    </div>
  );
}

/* ---------- FR-D4, FR-D5: filters, saved views and freshness ---------- */
interface View { id: string; name: string; period: PeriodKey; role: string; person: string }
const STARTER: View[] = [{ id: "all", name: "Whole team, this month", period: "month", role: "all", person: "all" }, { id: "tender", name: "Tender, this month", period: "month", role: "tender", person: "all" }];

/** SRS v0.5 §5.13 on sample data. */
export default function RoleDashboards() {
  const [tab, setTab] = useState("member");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [role, setRole] = useState("all");
  const [person, setPerson] = useState("all");
  const [mode, setMode] = useState<Mode>("peers");
  const [views, setViews] = useLocalState<View[]>("preview.views", STARTER);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [fresh, setFresh] = useState("2 minutes ago");
  const rows = useMemo(() => PEOPLE.filter((p) => (role === "all" || p.role === role) && (person === "all" || p.id === person)), [role, person]);
  const people = PEOPLE.filter((p) => role === "all" || p.role === role);
  const apply = (id: string) => { const v = views.find((x) => x.id === id); if (v) { setPeriod(v.period); setRole(v.role); setPerson(v.person); } };
  const current = views.find((v) => v.period === period && v.role === role && v.person === person)?.id ?? "";
  return (
    <PreviewPage title="Role dashboards" subtitle="One dashboard for each role: what a member, a supervisor and management need first.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4"><TabsTrigger value="member">Member</TabsTrigger><TabsTrigger value="supervisor">Supervisor</TabsTrigger><TabsTrigger value="management">Management</TabsTrigger></TabsList>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div><span className="label">Period</span><Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p.key, label: p.label }))} /></div>
          {tab !== "member" && (
            <>
              <Field label="Role profile" className="w-56"><NativeSelect value={role} onChange={(e) => { setRole(e.target.value); setPerson("all"); }}><option value="all">All role profiles</option>{roleKeys.map((r) => <option key={r} value={r}>{ROLES[r].name}</option>)}</NativeSelect></Field>
              <Field label="Person" className="w-44"><NativeSelect value={person} onChange={(e) => setPerson(e.target.value)}><option value="all">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
              <Field label="Saved view" className="w-52"><NativeSelect value={current} onChange={(e) => apply(e.target.value)}><option value="" disabled>Not saved</option>{views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</NativeSelect></Field>
              <Button variant="secondary" disabled={!!current} onClick={() => { setViewName(""); setNaming(true); }}><Save /> Save view</Button>
            </>)}
          <p className="ml-auto flex items-center gap-1 text-xs text-muted-foreground" role="status" data-fresh>Updated {fresh}<Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={() => setFresh("just now")}><RefreshCw /></Button></p>
        </div>
        <TabsContent value="member"><MemberView period={period} mode={mode} setMode={setMode} /></TabsContent>
        <TabsContent value="supervisor"><SupervisorView rows={rows} period={period} mode={mode} setMode={setMode} /></TabsContent>
        <TabsContent value="management"><ManagementView rows={rows} period={period} onDrill={(r) => { setRole(r); setPerson("all"); setTab("supervisor"); }} /></TabsContent>
      </Tabs>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); const id = `v${Date.now()}`; setViews([...views, { id, name: viewName.trim(), period, role, person }]); setNaming(false); sample("View saved"); }}>
            <DialogHeader><DialogTitle>Save this view</DialogTitle><DialogDescription>Keeps the period, role profile and person, so you can come back to them in one click.</DialogDescription></DialogHeader>
            <DialogBody><Field label="Name" required><Input value={viewName} maxLength={40} autoFocus onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Marketing, last month" /></Field></DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setNaming(false)}>Cancel</Button><Button type="submit" disabled={viewName.trim().length < 2}>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PreviewPage>
  );
}
