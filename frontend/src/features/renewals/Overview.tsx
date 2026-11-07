import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarSync, CheckCircle2, ChevronRight, Lightbulb, Percent } from "lucide-react";
import type { ComponentProps } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import { ChartCard, ChartLegend, ChartTooltip, useChartTheme } from "@/components/data/chart";
import { StatCard } from "@/components/data/stat-card";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Alert } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageSkeleton } from "@/components/ui/skeleton";
import { date, money, num, pct } from "@/lib/format";
import { KEY, STAGE_TONE, type Summary } from "./types";

/** The renewal dashboard (SRS FR-RN3): what's coming up, what's at risk, the renewal rate, and what else to offer. */

type Part = "renewed" | "open" | "lost";
const PARTS: { key: Part; name: string }[] = [{ key: "renewed", name: "Renewed" }, { key: "open", name: "To renew" }, { key: "lost", name: "Not renewed" }];
const short = (v: number) => money(v, { compact: true });

export const summaryQuery = { queryKey: [...KEY, "summary"], queryFn: async () => (await api.get<Summary>("/renewals/summary/")).data };

function DueByMonth({ s }: { s: Summary }) {
  const t = useChartTheme();
  const colour: Record<Part, string> = { renewed: t.status.good, open: t.status.pending, lost: t.status.critical };
  // Only the top segment of each stack gets the rounded end, so a stack reads as one bar.
  const data = s.by_month.map((b) => ({ ...b, label: format(parseISO(`${b.month}-01`), "MMM"), full: format(parseISO(`${b.month}-01`), "MMMM yyyy"),
    top: [...PARTS].reverse().find((p) => b[p.key] > 0)?.key ?? null }));
  const shape = (key: Part) => ({ payload, ...p }: ComponentProps<typeof Rectangle> & { payload?: { top: Part | null } }) => (
    <Rectangle {...p} fill={colour[key]} stroke={t.surface} strokeWidth={2} radius={payload?.top === key ? t.bar.radius : 0} />
  );
  const empty = data.every((b) => b.count === 0);
  return (
    <ChartCard className="lg:col-span-2" title="Renewals due by month"
      description={`Value of the contracts ending each month, for the next 12 months${s.scope === "mine" ? " (yours)" : ""}.`}
      legend={!empty && <ChartLegend items={PARTS.map((p) => ({ name: p.name, color: colour[p.key] }))} />}
      table={{ columns: ["Month", "Contracts", "Renewed", "To renew", "Not renewed"],
        rows: data.map((b) => [b.full, b.count, money(b.renewed), money(b.open), money(b.lost)]) }}>
      {empty ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">No contracts end in the next 12 months.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
            <CartesianGrid {...t.gridProps} />
            <XAxis dataKey="label" {...t.axis} />
            <YAxis {...t.axis} width={64} tickFormatter={(v: number) => money(v, { compact: true, currency: null })} />
            <Tooltip content={<ChartTooltip format={(v) => money(v)} />} cursor={t.cursor}
              labelFormatter={(_, p) => (p?.[0]?.payload as { full?: string } | undefined)?.full ?? ""} />
            {PARTS.map((p) => <Bar key={p.key} dataKey={p.key} name={p.name} stackId="due" fill={colour[p.key]} maxBarSize={t.bar.maxBarSize} shape={shape(p.key)} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function Overview({ isAdmin, onOpen, onAddContracts }: { isAdmin: boolean; onOpen: (id: number) => void; onAddContracts: () => void }) {
  const q = useQuery(summaryQuery);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const [first, ...later] = s.windows;

  if (s.contracts.total === 0) {
    return (
      <div className="card">
        <EmptyState icon={<CalendarSync />} title={isAdmin ? "Start by adding the contracts you renew" : "No contracts yet"}
          action={isAdmin && <Button onClick={onAddContracts}>Add contracts</Button>}>
          {isAdmin ? <>Add AMCs, licences and software with their end dates, by hand or from a CSV. Each renewal then opens by itself {first} days
            before the end, for the account owner, with reminders at {later.join(" and ")} days.</>
            : s.scope === "mine" ? "No contracts are assigned to you yet. When an admin adds one with you as the owner, its renewal shows up here." : "Admins haven't added any contracts yet."}
        </EmptyState>
      </div>
    );
  }

  const openTotal = s.stages.reduce((a, x) => a + x.count, 0);
  const w = s.warnings;
  return (
    <div className="space-y-6">
      {!!w.unowned && <Alert tone="amber">{w.unowned} open {w.unowned === 1 ? "contract has" : "contracts have"} no account owner, so nobody is reminded to renew {w.unowned === 1 ? "it" : "them"}. Set an owner in Contracts.</Alert>}
      {!!w.no_sheet?.length && (
        <Alert tone="amber">{w.no_sheet.join(", ")} {w.no_sheet.length === 1 ? "has" : "have"} no work sheet, so renewals they win don't count in the Revenue KPI.{" "}
          <Link to="/admin/settings" className="font-semibold underline">Give them one in Team setup</Link>.</Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Up for renewal" value={short(s.upcoming.value)} icon={<CalendarSync />}
          footer={`${s.upcoming.count} ${s.upcoming.count === 1 ? "contract ends" : "contracts end"} in the next ${s.upcoming.days} days`} />
        <StatCard label="Revenue at risk" value={short(s.at_risk.value)} icon={<AlertTriangle />}
          footer={s.at_risk.expired.count ? `${s.at_risk.expired.count} ended without a renewal · ${s.at_risk.count - s.at_risk.expired.count} end within ${s.at_risk.days} days`
            : `${s.at_risk.count} not renewed yet, ending within ${s.at_risk.days} days`} />
        <StatCard label="Renewal rate" value={pct(s.rate.rate)} icon={<Percent />}
          progress={s.rate.came_up ? { value: s.rate.renewed, max: s.rate.came_up, tone: "success" } : undefined}
          footer={s.rate.came_up ? `${s.rate.renewed} of ${s.rate.came_up} contracts · last 12 months` : "No contract has come up for renewal in the last 12 months"} />
        <StatCard label={`Renewed in ${s.renewed_month.month}`} value={short(s.renewed_month.value)} icon={<CheckCircle2 />}
          footer={`${s.renewed_month.count} ${s.renewed_month.count === 1 ? "renewal" : "renewals"}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <DueByMonth s={s} />
        <section className="card flex flex-col p-5">
          <h2 className="text-sm font-semibold">Open renewals by stage</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{openTotal} open · {money(s.stages.reduce((a, x) => a + x.value, 0), { compact: true })}</p>
          <ul className="mt-4 space-y-4">
            {s.stages.map((x) => (
              <li key={x.stage}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Badge tone={STAGE_TONE[x.stage]}>{x.label}</Badge>
                  <span className="tabular-nums text-muted-foreground"><b className="font-semibold text-foreground">{x.count}</b> · {short(x.value)}</span>
                </div>
                <Progress value={x.count} max={Math.max(openTotal, 1)} size="sm" label={`${x.label}: ${x.count} of ${openTotal}`} className="mt-2" />
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-5 text-xs text-muted-foreground">
            Renewals open {first} days before a contract ends{later.length ? `, with reminders at ${later.join(" and ")} days` : ""}.
            {s.revenue_weight > 0 ? ` A renewal counts ${num(s.revenue_weight, 0)}% in the owner's Revenue KPI.` : " Renewals don't count in the Revenue KPI."}
          </p>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning-text"><Lightbulb className="size-4" aria-hidden /></span>
          <div>
            <h2 className="text-sm font-semibold">What else to offer at renewal</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Products other clients have and these don't, plus the owner's own ideas. Renewals in the next {first} days.</p>
          </div>
        </div>
        {s.upsell.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No ideas yet. They appear when other clients buy products these clients don't have, or when an owner notes an upgrade on a renewal.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {s.upsell.map((u) => (
              <li key={u.renewal}>
                <button type="button" onClick={() => onOpen(u.renewal)}
                  className="flex w-full items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm"><span className="font-semibold">{u.client}</span> <span className="text-muted-foreground">· {u.product} · ends {date(u.end_date, "short")}</span></div>
                    {u.note && <p className="mt-1 text-sm">“{u.note}”</p>}
                    {u.ideas.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {u.ideas.map((i) => <Badge key={i.product} tone="outline">{i.product} · {i.clients} clients have it</Badge>)}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
