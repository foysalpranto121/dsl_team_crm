import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Award, CalendarCheck2, Flag, Lightbulb, Sparkles, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress as Meter, ProgressRing, toneForRatio } from "@/components/ui/progress";
import { PageSkeleton } from "@/components/ui/skeleton";
import { date, money, num } from "@/lib/format";
import { addDays } from "../log/util";
import { SuggestionCard } from "../playbook/Playbook";
import { StreaksCard } from "../recognition/StreaksCard";
import { monthRange, type DrillTarget, type KpiMetric } from "../scoring/api";
import { Drill, LedgerDrawer } from "../scoring/LedgerDrawer";
import { PILL, progressQuery, type Analysis, type Metric, type Progress, type Recap } from "./api";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const TH = "px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function Ring({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const r = target > 0 ? value / target : 0;
  return (
    <div className="flex items-center gap-3">
      <ProgressRing value={Math.min(100, Math.round(r * 100))} size={68} stroke={7} tone={toneForRatio(r)} label={`${label}: ${Math.round(r * 100)}% of target`}>
        <span className="text-xs font-semibold tabular-nums">{Math.round(r * 100)}%</span>
      </ProgressRing>
      <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{num(value)} <span className="font-normal text-muted-foreground">of {num(target)} {unit}</span></div></div>
    </div>
  );
}

function MetricRow({ m, currency, onDrill }: { m: Metric; currency: string; onDrill: () => void }) {
  const show = (v: number) => (m.key === "revenue" ? money(v, { compact: true, currency }) : num(v));
  const r = m.target > 0 ? m.actual / m.target : 0;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0"><span className="text-sm font-semibold">{m.label}</span> <span className="text-xs text-muted-foreground">this {m.period}</span></div>
        <div className="flex items-center gap-2 text-sm tabular-nums"><span><Drill onClick={onDrill} what={m.label.toLowerCase()}>{show(m.actual)}</Drill> <span className="text-muted-foreground">of {show(m.target)}</span></span>
          {m.target > 0 && <StatusPill status={PILL[m.status] ?? "neutral"}>{m.status_label}</StatusPill>}</div>
      </div>
      {m.target > 0 && <Meter value={r * 100} tone={toneForRatio(r)} size="sm" label={`${m.label}: ${Math.round(r * 100)}% of target`} className="mt-2" />}
      <p className="mt-2 text-sm">{m.gap}</p>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">{m.means}</p>
        {m.action && <Button size="sm" variant="link" className="h-auto px-0 text-xs" asChild><Link to={m.action.to}>{m.action.label}</Link></Button>}
      </div>
    </li>
  );
}

function Projection({ d, currency }: { d: Progress; currency: string }) {
  const rows = d.metrics.filter((m) => m.projected && m.month_target > 0);
  if (!rows.length) return null;
  const show = (m: Metric, v: number) => (m.key === "revenue" ? money(v, { compact: true, currency }) : num(v));
  return (
    <section className="card overflow-hidden" aria-labelledby="pace-title">
      <div className="border-b border-border px-5 py-3">
        <h2 id="pace-title" className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="size-4 text-muted-foreground" aria-hidden />Where {d.month} is heading</h2>
        <p className="text-xs text-muted-foreground">At this pace, with a range from how much the last eight weeks varied.</p>
      </div>
      {d.biggest_gap && <p className="border-b border-border px-5 py-2.5 text-sm">{d.biggest_gap.text}</p>}
      <div role="region" aria-label={`Where ${d.month} is heading`} tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <table className="w-full min-w-[30rem] text-sm">
          <thead><tr className="border-b border-border"><th className={TH}>Metric</th><th className={`${TH} text-right`}>So far</th><th className={`${TH} text-right`}>Month target</th><th className={`${TH} text-right`}>On pace for</th><th className={`${TH} text-right`}>Range</th></tr></thead>
          <tbody className="tabular-nums">{rows.map((m) => (
            <tr key={m.key} className="border-b border-border last:border-0">
              <td className="px-3 py-1.5">{m.label}</td><td className="px-3 py-1.5 text-right">{show(m, m.month_actual)}</td><td className="px-3 py-1.5 text-right">{show(m, m.month_target)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{show(m, m.projected!.mid)}</td><td className="px-3 py-1.5 text-right text-muted-foreground">{show(m, m.projected!.low)} – {show(m, m.projected!.high)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </section>
  );
}

function AnalysisCard({ a }: { a: Analysis }) {
  const tiles: [string, string][] = [["Points per output hour", a.points_per_hour == null ? "—" : num(a.points_per_hour)], ["Plan vs actual", pct(a.adherence)], ["Changed from plan", pct(a.deviation_rate)], ["Calls per qualified lead", a.calls_per_lead == null ? "—" : num(a.calls_per_lead)]];
  return (
    <section className="card overflow-hidden" aria-labelledby="analysis-title">
      <div className="border-b border-border px-5 py-3"><h2 id="analysis-title" className="text-sm font-semibold">How the last 30 days were spent</h2>
        <p className="text-xs text-muted-foreground">{date(a.from, "short")} – {date(a.to, "short")}: {num(a.hours)} output hours, {num(a.points)} points.</p></div>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map(([k, v]) => <div key={k} className="bg-card px-4 py-2.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
      {a.mix.length > 0 && <div role="region" aria-label="Hours by category" tabIndex={0} className="overflow-x-auto border-t border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <table className="w-full min-w-[26rem] text-sm">
          <thead><tr className="border-b border-border"><th className={TH}>Category</th><th className={`${TH} text-right`}>Hours</th><th className={`${TH} text-right`}>Your mix</th><th className={`${TH} text-right`}>Your role's mix</th></tr></thead>
          <tbody className="tabular-nums">{a.mix.map((c) => <tr key={c.category} className="border-b border-border last:border-0"><td className="px-3 py-1.5">{c.category}</td><td className="px-3 py-1.5 text-right">{num(c.hours)}</td><td className="px-3 py-1.5 text-right">{pct(c.share)}</td><td className="px-3 py-1.5 text-right text-muted-foreground">{pct(c.expected)}</td></tr>)}</tbody>
        </table>
      </div>}
      {a.flags.length > 0 && <div className="border-t border-border px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Flag className="size-4 text-muted-foreground" aria-hidden />Worth a second look</h3>
        <p className="text-xs text-muted-foreground">These never change your points.</p>
        <ul className="mt-1.5 space-y-1 text-sm">{a.flags.map((f) => <li key={`${f.kind}-${f.day}`}><Link to={`/my-day?day=${f.day}`} className="hover:underline">{f.text}</Link></li>)}</ul>
      </div>}
    </section>
  );
}

export function RecapCard({ r, title = "Last week" }: { r: Recap; title?: string }) {
  return (
    <section className="card p-5" aria-labelledby="recap-title">
      <h2 id="recap-title" className="flex items-center gap-2 text-sm font-semibold"><Award className="size-4 text-muted-foreground" aria-hidden />{title}</h2>
      <p className="text-xs text-muted-foreground">{date(r.week_start, "short")} – {date(r.week_end, "short")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Output hours</dt><dd className="text-lg font-semibold tabular-nums">{num(r.hours)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Points</dt><dd className="text-lg font-semibold tabular-nums">{num(r.points)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Qualified leads</dt><dd className="text-lg font-semibold tabular-nums">{num(r.kpis.leads)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Plan done</dt><dd className="text-lg font-semibold tabular-nums">{pct(r.adherence)}</dd></div>
      </dl>
      {r.wins.length > 0 && <div className="mt-3"><h3 className="text-xs font-semibold text-muted-foreground">Wins</h3><ul className="mt-0.5 text-sm">{r.wins.map((w, i) => <li key={i}>{w.what}{w.details ? `: ${w.details}` : ""}</li>)}</ul></div>}
      {r.best_day && <p className="mt-3 text-sm"><span className="text-muted-foreground">Best day:</span> {date(r.best_day.day, "weekday")}, {num(r.best_day.points)} points.</p>}
      {r.improved.length > 0
        ? <div className="mt-2"><h3 className="text-xs font-semibold text-muted-foreground">What improved</h3><ul className="mt-0.5 list-disc pl-5 text-sm">{r.improved.map((x) => <li key={x}>{x}</li>)}</ul></div>
        : !r.best_day && <p className="mt-3 text-sm text-muted-foreground">Nothing logged that week.</p>}
    </section>
  );
}

/** My Progress (SRS v0.5 §10.5, FR-MO1, FR-G2, FR-AC1–AC3): rings, plain-language gaps, the coach and the weekly recap. Primary action: open the suggested action. */
export default function MyProgress() {
  const [params] = useSearchParams();
  const work = params.get("work");
  const q = useQuery(progressQuery(work));
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const currency = d.currency;
  const y = +d.today.slice(0, 4), mo = +d.today.slice(5, 7);
  const open = (m: Metric) => {
    const who = d.mine ? "" : `${d.person}: `;
    if (m.key === "hours") return setDrill({ title: `${who}Output hours this week`, sheet: d.work, from: d.review.week_start, to: addDays(d.review.week_start, 6) });
    setDrill({ title: `${who}${m.label} in ${d.month}`, sheet: d.work, ...monthRange(y, mo), ...(m.key === "points" ? {} : { metric: m.key as KpiMetric }) });
  };
  const top = d.suggested[0];
  return (
    <>
      <PageHeader title={d.mine ? "My Progress" : `${d.person}'s progress`} subtitle="Where you stand against your targets, in plain words. None of this changes a score."
        actions={d.mine ? <Button variant="secondary" asChild><Link to="/weekly-review"><CalendarCheck2 /> {d.review.submitted ? "This week's review" : "Weekly Review"}</Link></Button> : undefined} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {d.rings && <section className="card p-5" aria-label="Your rings">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <Ring label="Today" {...d.rings.day} /><Ring label="This week" {...d.rings.week} /><Ring label={`${d.month} points`} {...d.rings.month} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex items-center gap-2 text-sm"><Target className="size-4 text-muted-foreground" aria-hidden />Score so far in {d.month}: <span className="font-semibold tabular-nums">{pct(d.score)}</span></div>
                {d.forecast && <p className="mt-1 text-base font-medium">{d.forecast.text}</p>}
              </div>
              {top?.to && <Button asChild><Link to={top.to}>Open suggested action <ArrowRight /></Link></Button>}
            </div>
          </section>}

          <section className="card overflow-hidden" aria-labelledby="gaps-title">
            <h2 id="gaps-title" className="border-b border-border px-5 py-3 text-sm font-semibold">Your numbers, in plain words</h2>
            <ul className="divide-y divide-border">{d.metrics.map((m) => <MetricRow key={m.key} m={m} currency={currency} onDrill={() => open(m)} />)}</ul>
          </section>

          {d.coach && <Projection d={d} currency={currency} />}
          {d.analysis && <AnalysisCard a={d.analysis} />}
        </div>

        <aside className="space-y-5">
          {d.coach && (d.suggested.length > 0 || d.catch_up) && (
            <section className="card overflow-hidden" aria-labelledby="coach-title">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5"><h2 id="coach-title" className="text-sm font-semibold">AI Coach</h2>
                <Badge tone="outline"><Sparkles aria-hidden />Rules on your own numbers</Badge></div>
              {d.catch_up && <div className="border-b border-border px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="size-4 text-accent-text" aria-hidden />To catch up</h3>
                <p className="mt-1 text-sm font-medium">{d.catch_up.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.catch_up.basis}</p>
              </div>}
              {d.suggested.length > 0 && <ul className="divide-y divide-border">{d.suggested.map((s) => <SuggestionCard key={s.id} s={s} />)}</ul>}
            </section>
          )}
          <StreaksCard work={work} />
          {d.recap && <RecapCard r={d.recap} />}
          {d.mine && d.review.due && !d.review.submitted && (
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-4 text-sm"><p className="font-medium">Your Weekly Review is due today.</p><p className="mt-0.5 text-muted-foreground">Ten minutes to wrap up the week.</p>
              <Button size="sm" className="mt-2" asChild><Link to="/weekly-review">Start it</Link></Button></div>
          )}
          {!d.mine && <Button variant="ghost" asChild><Link to="/team-review"><ArrowLeft /> Back to the team review</Link></Button>}
        </aside>
      </div>
      <LedgerDrawer target={drill} onClose={() => setDrill(null)} />
    </>
  );
}
