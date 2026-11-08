import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, ChevronLeft, ChevronRight, Circle, ClipboardList, Trophy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageSkeleton } from "@/components/ui/skeleton";
import { date, money, num } from "@/lib/format";
import { addDays } from "../log/util";
import { teamReviewQuery } from "./api";

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const AGENDA: [string, string][] = [["Wins", "3 min"], ["Numbers against target", "5 min"], ["Stuck deals", "4 min"], ["Next week's focus and plans", "3 min"]];

function Mark({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return <span className="inline-flex items-center gap-1 text-xs">{on ? <Check className="size-3.5 text-success-text" aria-hidden /> : <Circle className="size-3.5 text-subtle-foreground" aria-hidden />}{on ? yes : no}</span>;
}

/** The team review (SRS v0.5 FR-WR2, FR-AC5): fifteen minutes, from the same data as everyone's Weekly Review. Also the one-page team summary of the week. */
export default function TeamReview() {
  const [week, setWeek] = useState<string | null>(null);
  const q = useQuery({ ...teamReviewQuery(week), placeholderData: (p) => p });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data, t = d.totals;
  const current = d.week_start === d.current_week_start;
  const tiles: [string, string][] = [["Output hours", `${num(t.hours ?? 0)} of ${num(t.hours_target ?? 0)}`], ["Points", num(t.points ?? 0)], ["Qualified leads", num(t.leads ?? 0)], ["Opportunities", num(t.opps ?? 0)], ["Clients", num(t.clients ?? 0)], ["Revenue", money(t.revenue ?? 0, { compact: true, currency: d.currency })]];
  return (
    <>
      <PageHeader title="Team review" subtitle={`Week ${d.week_no} · ${date(d.week_start, "short")} – ${date(d.week_end, "short")}. Fifteen minutes, from the same numbers everyone confirmed.`}
        actions={<div className="flex items-center gap-1.5">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => setWeek(addDays(d.week_start, -7))}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label="Next week" disabled={current} onClick={() => setWeek(addDays(d.week_start, 7))}><ChevronRight /></Button>
          {!current && <Button variant="ghost" size="sm" onClick={() => setWeek(null)}>This week</Button>}
        </div>} />
      {!d.rows.length ? <div className="card"><EmptyState icon={<ClipboardList />} title="No one to review">Give people a daily log in Team setup.</EmptyState></div> : <>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="card overflow-hidden" aria-label="The week's numbers">
            <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">{tiles.map(([k, v]) => <div key={k} className="bg-card px-5 py-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}</dl>
            <div className="grid gap-4 border-t border-border px-5 py-3 sm:grid-cols-2">
              <div><div className="flex justify-between text-xs"><span className="text-muted-foreground">Reviews submitted</span><span className="tabular-nums">{d.reviewed} of {d.rows.length}</span></div><Progress value={d.reviewed} max={d.rows.length} size="sm" label="Reviews submitted" className="mt-1" /></div>
              <div><div className="flex justify-between text-xs"><span className="text-muted-foreground">Next week's plans sent</span><span className="tabular-nums">{d.plans_sent} of {d.rows.length}</span></div><Progress value={d.plans_sent} max={d.rows.length} size="sm" label="Next week's plans sent" className="mt-1" /></div>
            </div>
          </section>
          <section className="card p-4" aria-labelledby="agenda-title">
            <h2 id="agenda-title" className="text-sm font-semibold">Agenda</h2>
            <ol className="mt-2 space-y-1.5 text-sm">{AGENDA.map(([a, b], i) => <li key={a} className="flex justify-between gap-2"><span>{i + 1}. {a}</span><span className="shrink-0 text-xs text-muted-foreground">{b}</span></li>)}</ol>
          </section>
        </div>

        <section className="card mt-5 overflow-hidden" aria-labelledby="wins-title">
          <h2 id="wins-title" className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold"><Trophy className="size-4 text-muted-foreground" aria-hidden />Wins <span className="font-normal text-muted-foreground">· {d.wins.length}</span></h2>
          {d.wins.length ? <ul className="divide-y divide-border">{d.wins.map((w, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm"><span><BadgeCheck className="mr-1.5 inline size-4 text-success-text" aria-hidden />{w.person}: {w.what}</span><span className="text-xs text-muted-foreground">{date(w.day, "short")}</span></li>)}</ul>
            : <p className="px-5 py-3 text-sm text-muted-foreground">No verified wins this week yet.</p>}
        </section>

        <section className="card mt-5 overflow-hidden" aria-labelledby="people-title">
          <h2 id="people-title" className="border-b border-border px-5 py-3 text-sm font-semibold">Person by person</h2>
          <div role="region" aria-label="Person by person" tabIndex={0} className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
            <table className="w-full min-w-[60rem] text-sm">
              <thead><tr className="border-b border-border"><th className={TH}>Person</th><th className={`${TH} text-right`}>Hours</th><th className={`${TH} text-right`}>Points</th><th className={`${TH} text-right`}>Leads</th><th className={`${TH} text-right`}>Opps</th><th className={`${TH} text-right`}>Clients</th><th className={`${TH} text-right`}>Revenue</th><th className={`${TH} text-right`}>Deals touched</th><th className={`${TH} text-right`}>Stuck</th><th className={TH}>Review</th><th className={TH}>Next week</th><th className={TH}>Focus</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.work} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2"><Link to={`/my-progress?work=${r.work}`} className="font-medium hover:underline">{r.person}</Link><div className="text-xs text-muted-foreground">{r.role ?? "No job role"}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.hours)}<span className="text-muted-foreground"> / {num(r.hours_target)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.points)}</td><td className="px-3 py-2 text-right tabular-nums">{num(r.leads)}</td><td className="px-3 py-2 text-right tabular-nums">{num(r.opps)}</td><td className="px-3 py-2 text-right tabular-nums">{num(r.clients)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(r.revenue, { compact: true, currency: null })}</td><td className="px-3 py-2 text-right tabular-nums">{r.deals_touched}</td><td className="px-3 py-2 text-right tabular-nums">{r.stuck}</td>
                  <td className="whitespace-nowrap px-3 py-2"><Link to={`/weekly-review?work=${r.work}&week=${d.week_start}`} className="block hover:underline"><Mark on={r.reviewed} yes="Submitted" no="Not yet" /></Link><Mark on={r.kpi_confirmed} yes="KPIs confirmed" no="KPIs not confirmed" /></td>
                  <td className="whitespace-nowrap px-3 py-2"><Mark on={r.plan_sent} yes={r.plan_status} no={r.plan_status} /></td>
                  <td className="min-w-44 px-3 py-2">{r.focus || <span className="text-muted-foreground">Not picked yet</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      </>}
    </>
  );
}
