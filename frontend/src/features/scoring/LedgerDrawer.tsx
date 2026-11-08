import { useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { api } from "@/api/client";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { date, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIND_LABEL, ledgerQuery, METRIC_LABEL, type DrillTarget, type KpiResponse, type LedgerResponse } from "./api";

/** A number you can open: the visible number plus, for screen readers, what opening it shows (SRS v0.5 FR-S3). */
export function Drill({ onClick, what, children, className }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; what: string; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-sm text-inherit underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", className)}>
      {children}<span className="sr-only">: see the entries behind {what}</span>
    </button>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** A table that may scroll sideways on a phone: focusable, so it scrolls from the keyboard too (WCAG 2.1.1). */
function ScrollX({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", className)}>{children}</div>;
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-lg border border-border px-3 py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>;
}

const TH = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

interface Perf {
  rows: { id: number; months: { m: number; state: string; version?: number | null; avg_weekly?: number; points?: number; score?: number; leads?: number; opps?: number; clients?: number; revenue?: number;
    target?: Record<string, number>; ratio?: Record<string, number>; weights?: Record<string, number> }[] }[];
}

/** FR-S4: how a composite score was worked out: Σ weight × (actual ÷ target), with the month's own configuration version. */
function ScoreBreakdown({ sheet, year, month }: { sheet: number; year: number; month: number }) {
  const q = useQuery({ queryKey: ["performance", "drill", year], queryFn: async () => (await api.get<Perf>(`/team/performance/?year=${year}`)).data });
  if (!q.data) return <Skeleton className="h-40" />;
  const m = q.data.rows.find((r) => r.id === sheet)?.months[month - 1];
  if (!m?.ratio || !m.target || !m.weights) return <p className="text-sm text-muted-foreground">This month has no score.</p>;
  const rows = [
    { key: "hours", label: "Average weekly hours", actual: m.avg_weekly ?? 0 }, { key: "points", label: "Points", actual: m.points ?? 0 }, { key: "leads", label: "Qualified leads", actual: m.leads ?? 0 },
    { key: "opps", label: "Opportunities", actual: m.opps ?? 0 }, { key: "clients", label: "Clients", actual: m.clients ?? 0 }, { key: "revenue", label: "Revenue", actual: m.revenue ?? 0 },
  ];
  return (
    <section aria-labelledby="score-how">
      <h3 id="score-how" className="text-sm font-semibold">How the score was worked out</h3>
      <p className="text-xs text-muted-foreground">Each metric's weight × actual ÷ target{m.version ? `, with configuration version ${m.version}` : ""}.</p>
      <ScrollX label="How the score was worked out" className="mt-2">
        <table className="w-full min-w-[30rem] text-sm">
          <thead><tr className="border-b border-border"><th className={TH}>Metric</th><th className={cn(TH, "text-right")}>Actual</th><th className={cn(TH, "text-right")}>Target</th>
            <th className={cn(TH, "text-right")}>Achieved</th><th className={cn(TH, "text-right")}>Weight</th><th className={cn(TH, "text-right")}>Adds</th></tr></thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5 text-right">{num(r.actual)}</td>
                <td className="px-2 py-1.5 text-right">{m.target![r.key] > 0 ? num(m.target![r.key]) : "—"}</td>
                <td className="px-2 py-1.5 text-right">{pct(m.ratio![r.key])}</td>
                <td className="px-2 py-1.5 text-right">{num(m.weights![r.key], 0)}%</td>
                <td className="px-2 py-1.5 text-right font-medium">{pct((m.weights![r.key] / 100) * m.ratio![r.key])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border font-semibold"><td className="px-2 py-1.5" colSpan={5}>Composite score</td><td className="px-2 py-1.5 text-right tabular-nums">{pct(m.score)}</td></tr></tfoot>
        </table>
      </ScrollX>
    </section>
  );
}

function Ledger({ d, team }: { d: LedgerResponse; team: boolean }) {
  if (!d.rows.length) return <EmptyState compact icon={<ReceiptText />} title="Nothing counted in this period">Hours count once they're logged and approved where approval is needed; events once they're verified.</EmptyState>;
  return (
    <>
      <dl className="grid grid-cols-3 gap-2">
        <Tile label="Points" value={num(d.totals.points)} /><Tile label="Output hours" value={num(d.totals.hours)} /><Tile label="Entries" value={num(d.totals.entries)} />
      </dl>
      {d.by_category.length > 1 && (
        <section aria-labelledby="by-cat">
          <h3 id="by-cat" className="text-sm font-semibold">By category</h3>
          <table className="mt-1 w-full text-sm">
            <thead><tr className="border-b border-border"><th className={TH}>Category</th><th className={cn(TH, "text-right")}>Hours</th><th className={cn(TH, "text-right")}>Points</th></tr></thead>
            <tbody className="tabular-nums">{d.by_category.map((c) => <tr key={c.name} className="border-b border-border last:border-0">
              <td className="px-2 py-1.5">{c.name}</td><td className="px-2 py-1.5 text-right">{num(c.hours)}</td><td className="px-2 py-1.5 text-right">{num(c.points)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <section aria-labelledby="entries-h">
        <h3 id="entries-h" className="text-sm font-semibold">Entries</h3>
        <ScrollX label="Entries" className="mt-1">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-b border-border"><th className={TH}>Date</th><th className={TH}>Hour</th>{team && <th className={TH}>Person</th>}<th className={TH}>Activity</th><th className={TH}>From</th><th className={cn(TH, "text-right")}>Points</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{date(r.day, "short")}</td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.slot != null ? `H-${r.slot + 1}` : <Badge tone="outline">Event</Badge>}</td>
                {team && <td className="px-2 py-1.5">{r.person}</td>}
                <td className="px-2 py-1.5"><div>{r.activity}{r.quantity > 1 ? ` × ${r.quantity}` : ""}</div><div className="text-xs text-muted-foreground">{r.category}</div></td>
                <td className="px-2 py-1.5 text-muted-foreground"><div>{r.source_label}</div><div className="text-xs">Version {r.version}</div></td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{num(r.points)}</td>
              </tr>))}</tbody>
          </table>
        </ScrollX>
        {d.truncated && <p className="mt-2 text-xs text-muted-foreground">Showing the newest {num(d.rows.length)} of {num(d.totals.entries)} entries. The totals above cover all of them.</p>}
      </section>
    </>
  );
}

function Kpi({ d, team }: { d: KpiResponse; team: boolean }) {
  const isMoney = d.metric === "revenue";
  const show = (v: number) => (isMoney ? money(v, { currency: d.currency }) : num(v));
  if (!d.rows.length) return <EmptyState compact icon={<ReceiptText />} title="Nothing counted in this period">A record counts here in the week it first reaches the stage this KPI follows.</EmptyState>;
  return (
    <>
      <dl className="grid grid-cols-2 gap-2"><Tile label={METRIC_LABEL[d.metric]} value={show(d.totals.value)} /><Tile label="Entries" value={num(d.totals.entries)} /></dl>
      <ScrollX label="Entries">
        <table className="w-full min-w-[30rem] text-sm">
          <thead><tr className="border-b border-border"><th className={TH}>Week of</th>{team && <th className={TH}>Person</th>}<th className={TH}>What</th><th className={TH}>From</th><th className={cn(TH, "text-right")}>{isMoney ? "Value" : "Counts"}</th></tr></thead>
          <tbody>{d.rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{date(r.week, "short")}</td>
              {team && <td className="px-2 py-1.5">{r.person}</td>}
              <td className="px-2 py-1.5"><div>{r.what}</div>{r.day && <div className="text-xs text-muted-foreground">Reached it on {date(r.day, "short")}</div>}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{KIND_LABEL[r.kind]}</td>
              <td className="px-2 py-1.5 text-right font-medium tabular-nums">{show(r.value)}</td>
            </tr>))}</tbody>
        </table>
      </ScrollX>
    </>
  );
}

/** Any number → the entries behind it (SRS v0.5 FR-S3, acceptance test 6). */
export function LedgerDrawer({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const q = useQuery({ ...ledgerQuery(target ?? { title: "", from: "2000-01-01", to: "2000-01-01" }), enabled: !!target });
  const team = !target?.sheet;
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        {target && <>
          <SheetHeader>
            <SheetTitle>{target.title}</SheetTitle>
            <SheetDescription>{target.subtitle ?? (target.from === target.to ? date(target.from, "long") : `${date(target.from, "short")} – ${date(target.to, "medium")}`)}</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-5">
            {target.score && target.sheet && <ScoreBreakdown sheet={target.sheet} year={target.score.year} month={target.score.month} />}
            {target.scores && (
              <section aria-labelledby="avg-of">
                <h3 id="avg-of" className="text-sm font-semibold">The average of</h3>
                <table className="mt-1 w-full text-sm"><tbody className="tabular-nums">{target.scores.map((s) => <tr key={s.label} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">{s.label}</td><td className="px-2 py-1.5 text-right font-medium">{pct(s.score)}</td></tr>)}</tbody></table>
              </section>
            )}
            {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
              : q.data && (q.data.metric ? <Kpi d={q.data as KpiResponse} team={team} /> : <Ledger d={q.data as LedgerResponse} team={team} />)}
          </SheetBody>
        </>}
      </SheetContent>
    </Sheet>
  );
}
