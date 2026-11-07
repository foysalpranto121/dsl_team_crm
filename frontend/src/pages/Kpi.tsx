import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck2, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api, errorText } from "../api/client";
import type { DashboardRow } from "../api/types";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

interface Kpi { week_start: string; leads: number; opps: number; clients: number; revenue: string; notes: string; updated_by: string | null; updated_at: string }
/** renewals: revenue from renewals won that week (the renewal tracker adds it on top of the revenue typed here). */
interface KpiRow { sheet: number; name: string; person: string; role: string | null; mine: boolean; editable: boolean; blocked: string | null; kpi: Kpi | null; renewals: number;
  targets: { leads: number; opps: number; clients: number; revenue: number } }
interface KpiWeek { week_start: string; week_end: string; week_no: number; today: string; current_week_start: string; counts_in_month: string; rows: KpiRow[] }

const utc = (s: string) => new Date(s + "T00:00:00Z");
const shift = (s: string, n: number) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const short = (s: string) => utc(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthName = (ym: string) => utc(ym + "-01").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const money = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const FIELDS = [["leads", "Leads", "Client shows interest"], ["opps", "Opportunities", "Client shares requirements"], ["clients", "Clients", "Client issues a work order"]] as const;

/** Renewals won that week count on top of the revenue typed in, so nobody types them twice. */
function RenewalsNote({ amount }: { amount: number }) {
  if (!amount) return null;
  return <Link to="/renewals?tab=renew" className="mt-1 block whitespace-nowrap text-right text-[11px] font-medium text-success-text hover:underline"
    title="Renewals recorded in Renewals count on top of the revenue typed here. Don't type them again.">+ {money.format(amount)} renewals</Link>;
}

function Row({ row, week }: { row: KpiRow; week: string }) {
  const qc = useQueryClient();
  const init = { leads: String(row.kpi?.leads ?? 0), opps: String(row.kpi?.opps ?? 0), clients: String(row.kpi?.clients ?? 0),
    revenue: String(Math.round(+(row.kpi?.revenue ?? 0))), notes: row.kpi?.notes ?? "" };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const save = useMutation({
    mutationFn: async () => (await api.put(`/team/sheets/${row.sheet}/kpis/${week}/`, { leads: +f.leads || 0, opps: +f.opps || 0, clients: +f.clients || 0,
      revenue: f.revenue || "0", notes: f.notes.trim() })).data,
    onSuccess: () => ["kpi-week", "dashboard", "performance"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  const num = "num w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm focus:outline-2 focus:outline-brand-400 dark:border-white/15 dark:bg-white/5";
  return (
    <>
      <tr className={clsx("border-b border-slate-100 dark:border-white/5", row.mine && "bg-accent-500/[0.04]")}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold">{row.person}{row.mine && <Badge tone="accent">You</Badge>}</div>
          <div className="text-xs text-slate-500">{row.role ?? "No job role"}</div>
        </td>
        {row.editable ? (
          <>
            {FIELDS.map(([k]) => <td key={k} className="px-2 py-2.5 text-right"><input type="number" min={0} step={1} value={f[k]} aria-label={`${k} for ${row.person}`}
              onChange={(e) => setF({ ...f, [k]: e.target.value })} className={num} /></td>)}
            <td className="px-2 py-2.5 text-right"><input type="number" min={0} step={1000} value={f.revenue} aria-label={`Revenue for ${row.person}`}
              onChange={(e) => setF({ ...f, revenue: e.target.value })} className={clsx(num, "w-28")} />
              <RenewalsNote amount={row.renewals} /></td>
            <td className="px-2 py-2.5"><input value={f.notes} maxLength={2000} placeholder="Clients, deals…" aria-label={`Notes for ${row.person}`}
              onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-2 focus:outline-brand-400 dark:border-white/15 dark:bg-white/5" /></td>
            <td className="px-4 py-2.5 text-right"><Button className="py-1.5" onClick={() => save.mutate()} busy={save.isPending} disabled={!dirty}>Save</Button></td>
          </>
        ) : (
          <>
            {FIELDS.map(([k]) => <td key={k} className="num px-4 py-2.5 text-right">{row.kpi ? row.kpi[k] : <span className="text-slate-300 dark:text-white/20">—</span>}</td>)}
            <td className="num px-4 py-2.5 text-right">{row.kpi ? money.format(+row.kpi.revenue) : <span className="text-slate-300 dark:text-white/20">—</span>}
              <RenewalsNote amount={row.renewals} /></td>
            <td className="max-w-56 truncate px-4 py-2.5 text-xs text-slate-500" title={row.kpi?.notes}>{row.kpi?.notes}</td>
            <td className="px-4 py-2.5 text-right" title={row.blocked ?? undefined}><Lock className="ml-auto size-4 text-slate-400" aria-label={row.blocked ?? "Locked"} /></td>
          </>
        )}
      </tr>
      {save.error && <tr><td colSpan={7} className="px-4 pb-3"><Alert>{errorText(save.error)}</Alert></td></tr>}
    </>
  );
}

export default function KpiPage() {
  const [week, setWeek] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["kpi-week", week], queryFn: async () => (await api.get<KpiWeek>(`/team/kpi-week/${week ? `?week=${week}` : ""}`)).data });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await api.get<{ rows: DashboardRow[] }>("/team/dashboard/")).data });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{errorText(q.error)}</Alert>;
  const d = q.data!;
  const isCurrent = d.week_start === d.current_week_start;

  return (
    <>
      <PageHeader title="Weekly KPI" subtitle="Leads, opportunities, clients and revenue for each week (Saturday to Friday). Enter yours by Friday."
        actions={<div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Previous week" onClick={() => setWeek(shift(d.week_start, -7))}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-44 text-center text-sm font-semibold">Week {d.week_no} · {short(d.week_start)} – {short(d.week_end)}</span>
          <Button variant="secondary" aria-label="Next week" onClick={() => setWeek(shift(d.week_start, 7))} disabled={d.week_start >= d.current_week_start}><ChevronRight className="size-4" /></Button>
          {!isCurrent && <Button variant="ghost" onClick={() => setWeek(null)}>This week</Button>}
        </div>} />

      <p className="mb-4 text-sm text-slate-500">This week counts in <b>{monthName(d.counts_in_month)}</b>, the month that holds most of its days.
        {isCurrent ? " You can change your own row until the week ends." : " Past weeks are locked; admins can still correct them."}</p>

      {d.rows.length === 0 ? <Card><EmptyState icon={<CalendarCheck2 />} title="No daily logs yet">Create daily logs in Team setup first.</EmptyState></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="bg-brand-700 text-left text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-brand-800">
                <th className="px-4 py-2.5">Person</th>
                {FIELDS.map(([k, label, hint]) => <th key={k} className="px-4 py-2.5 text-right" title={hint}>{label}</th>)}
                <th className="px-4 py-2.5 text-right">Revenue (BDT)</th><th className="px-4 py-2.5">Notes</th><th className="px-4 py-2.5" />
              </tr></thead>
              <tbody>{d.rows.map((r) => <Row key={`${r.sheet}-${d.week_start}-${r.kpi?.updated_at ?? ""}`} row={r} week={d.week_start} />)}</tbody>
            </table>
          </div>
        </Card>
      )}

      {dash.data && dash.data.rows.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="text-base font-bold">This month so far, against monthly targets</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dash.data.rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                <div className="font-semibold">{r.person || r.name}</div>
                {(["leads", "opps", "clients", "revenue"] as const).map((k) => {
                  const v = r.kpi_month[k], t = r.kpi_targets[k], pct = t > 0 ? Math.min(100, (v / t) * 100) : 0;
                  return (
                    <div key={k} className="mt-2">
                      <div className="flex justify-between text-xs text-slate-500"><span className="capitalize">{k === "opps" ? "Opportunities" : k}</span>
                        <span className="num">{k === "revenue" ? money.format(v) : v} / {t > 0 ? (k === "revenue" ? money.format(t) : t) : "—"}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className={clsx("h-full rounded-full", pct >= 100 ? "bg-leaf-500" : "bg-brand-600 dark:bg-brand-300")} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
