import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorText } from "../api/client";
import DownloadExcel from "../components/DownloadExcel";
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { monthRange, type DrillTarget, type KpiMetric } from "../features/scoring/api";
import { Drill, LedgerDrawer } from "../features/scoring/LedgerDrawer";

type Metrics = { hours?: number; avg_weekly?: number | null; points?: number; leads?: number; opps?: number; clients?: number; revenue?: number; score?: number | null };
type Month = Metrics & { m: number; state: "future" | "before" | "current" | "done" };
type Roll = Metrics & { months?: number };
interface Row { id: number; name: string; person: string; role: string | null; start: string; months: Month[]; quarters: Roll[]; year: Roll }
type TeamRow = Pick<Row, "months" | "quarters" | "year">;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VIEWS = [
  { key: "score", label: "Score", hint: "Role-weighted: Σ weight × (actual ÷ own target). Quarter and year = average of completed months." },
  { key: "avg_weekly", label: "Avg hours / week", hint: "Hours in the month ÷ weeks in the month (from the start date)." },
  { key: "points", label: "Points", hint: "Points earned from the sheet." },
  { key: "leads", label: "Leads", hint: "From weekly KPIs; each week counts in the month holding most of its days." },
  { key: "opps", label: "Opportunities", hint: "From weekly KPIs." },
  { key: "clients", label: "Clients", hint: "From weekly KPIs." },
  { key: "revenue", label: "Revenue (BDT)", hint: "From weekly KPIs." },
] as const;
type View = (typeof VIEWS)[number]["key"];
const LINE = ["#034ea1", "#ec1c24", "#00a550", "#e0a21b", "#7c3aed", "#0891b2", "#db2777"];
const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const pct = (v: number) => `${Math.round(v * 100)}%`;

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

export default function Performance() {
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<View>("score");
  const dark = useIsDark();
  const [drill, setDrill] = useState<DrillTarget | null>(null);   // SRS v0.5 FR-S3: the entries behind a number
  const q = useQuery({
    queryKey: ["performance", year],
    queryFn: async () => (await api.get<{ year: number; date: string; rows: Row[]; team: TeamRow | null }>(`/team/performance/${year ? `?year=${year}` : ""}`)).data,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{errorText(q.error)}</Alert>;
  const { rows, team, year: y, date } = q.data!;
  const thisYear = +date.slice(0, 4);
  const fmt = (v: number | null | undefined) => v == null ? "" : view === "score" ? pct(v) : nf.format(v);
  const tone = (v: number | null | undefined) => view !== "score" || v == null ? "" : v >= 1 ? "text-leaf-600 dark:text-leaf-400" : v >= 0.8 ? "text-amber-600" : "text-accent-600 dark:text-accent-400";

  const chart = MONTHS.map((label, i) => {
    const point: Record<string, string | number | null> = { name: label };
    rows.forEach((r) => { const m = r.months[i]; point[r.person || r.name] = m.score != null && (m.state === "done" || m.state === "current") ? Math.round(m.score * 100) : null; });
    return point;
  });
  const axis = dark ? "#9aa7bf" : "#5b6880", grid = dark ? "rgba(255,255,255,.08)" : "#e2e8f0";
  const viewLabel = VIEWS.find((v) => v.key === view)!.label;
  /** A cell of the table → the entries behind it. r = null is the team's row. */
  const open = (r: Row | null, label: string, m1: number, m2: number) => {
    const who = r ? r.person || r.name : "Team";
    const base = { title: `${who}: ${viewLabel.toLowerCase()}, ${label}`, sheet: r?.id ?? null, from: monthRange(y, m1).from, to: monthRange(y, m2).to };
    if (view === "score") {
      if (r && m1 === m2) return setDrill({ ...base, score: { year: y, month: m1 } });
      if (r) return setDrill({ ...base, scores: r.months.slice(m1 - 1, m2).filter((m) => m.state === "done").map((m) => ({ label: `${MONTHS[m.m - 1]} ${y}`, score: m.score ?? null })) });
      const of = (x: Row) => (m1 === m2 ? x.months[m1 - 1].score : m2 - m1 === 2 ? x.quarters[(m1 - 1) / 3].score : x.year.score) ?? null;
      return setDrill({ ...base, scores: rows.map((x) => ({ label: x.person || x.name, score: of(x) })) });
    }
    setDrill(view === "points" || view === "avg_weekly" ? base : { ...base, metric: view as KpiMetric });
  };
  const cell = (v: number | null | undefined, r: Row | null, label: string, m1: number, m2: number) =>
    v == null ? fmt(v) : <Drill onClick={() => open(r, label, m1, m2)} what={`${r ? r.person || r.name : "the team"}, ${label}`}>{fmt(v)}</Drill>;

  return (
    <>
      <PageHeader title="Performance" subtitle="Every month of the year, from each person's start date. Earlier months and the year so far are included."
        actions={<div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Previous year" onClick={() => setYear(y - 1)}><ChevronLeft className="size-4" /></Button>
          <span className="num min-w-16 text-center text-sm font-semibold">{y}</span>
          <Button variant="secondary" aria-label="Next year" onClick={() => setYear(y + 1)} disabled={y >= thisYear}><ChevronRight className="size-4" /></Button>
          <span className="ml-2"><DownloadExcel year={y} label="Download team Excel" /></span>
        </div>} />

      {rows.length === 0 ? <Card><EmptyState icon={<BarChart3 />} title="No daily logs yet">Import the Excel workbook or create daily logs in Team setup.</EmptyState></Card> : (
        <>
          <Card className="mb-6 p-5">
            <h2 className="text-base font-bold">Composite score by month</h2>
            <p className="text-xs text-slate-500">100% = exactly on target. The current month is the score so far.</p>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ left: -12, right: 12 }}>
                  <CartesianGrid vertical={false} stroke={grid} />
                  <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: dark ? "#072f5e" : "#fff", border: `1px solid ${grid}`, borderRadius: 12, fontSize: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  {rows.map((r, i) => <Line key={r.id} type="monotone" dataKey={r.person || r.name} stroke={LINE[i % LINE.length]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="What to show">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
                className={clsx("rounded-full border px-3 py-1.5 text-sm font-medium", view === v.key ? "border-brand-700 bg-brand-700 text-white dark:border-brand-300 dark:bg-brand-300 dark:text-brand-950"
                  : "border-slate-300 bg-white text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200")}>{v.label}</button>
            ))}
          </div>
          <p className="mb-3 text-xs text-slate-500">{VIEWS.find((v) => v.key === view)!.hint}</p>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                <thead><tr className="bg-brand-700 text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-brand-800">
                  <th className="sticky left-0 z-10 bg-brand-700 px-4 py-2.5 text-left dark:bg-brand-800">Person</th>
                  {MONTHS.map((m) => <th key={m} className="px-3 py-2.5 text-right">{m}</th>)}
                  {["Q1", "Q2", "Q3", "Q4"].map((x) => <th key={x} className="bg-brand-800 px-3 py-2.5 text-right dark:bg-brand-900">{x}</th>)}
                  <th className="bg-brand-900 px-3 py-2.5 text-right">{y}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 dark:border-white/5 dark:bg-[#0a1a31]">
                        <div className="font-semibold">{r.person || r.name}</div><div className="text-xs text-slate-500">{r.role ?? "No job role"} · from {r.start}</div>
                      </td>
                      {r.months.map((m) => (
                        <td key={m.m} className={clsx("num border-b border-slate-100 px-3 py-2.5 text-right dark:border-white/5", tone(m[view]),
                          m.state === "before" && "text-slate-300 dark:text-white/20", m.state === "current" && "bg-accent-500/[0.05]")}
                          title={m.state === "before" ? "Before the start date: shown, not scored" : m.state === "current" ? "This month so far" : undefined}>
                          {m.state === "future" ? "" : m.state === "before" && (view === "score" || view === "avg_weekly") ? "—" : cell(m[view], r, `${MONTHS[m.m - 1]} ${y}`, m.m, m.m)}
                        </td>
                      ))}
                      {r.quarters.map((qq, i) => <td key={i} className={clsx("num border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-right font-medium dark:border-white/5 dark:bg-white/[0.03]", tone(qq[view]))}>{cell(qq[view], r, `Q${i + 1} ${y}`, i * 3 + 1, i * 3 + 3)}</td>)}
                      <td className={clsx("num border-b border-slate-100 bg-brand-50 px-3 py-2.5 text-right font-bold dark:border-white/5 dark:bg-brand-400/10", tone(r.year[view]))}>{cell(r.year[view], r, String(y), 1, 12)}</td>
                    </tr>
                  ))}
                </tbody>
                {team && rows.length > 1 && (
                  <tfoot><tr className="font-semibold">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 dark:bg-[#0a1a31]"><div>Team</div><div className="text-xs font-normal text-slate-500">{view === "score" || view === "avg_weekly" ? "Average of the team" : "Team total"}</div></td>
                    {team.months.map((m) => <td key={m.m} className={clsx("num px-3 py-2.5 text-right", tone(m[view]), m.state === "current" && "bg-accent-500/[0.05]")}>{m.state === "future" || m.state === "before" ? "" : cell(m[view], null, `${MONTHS[m.m - 1]} ${y}`, m.m, m.m)}</td>)}
                    {team.quarters.map((qq, i) => <td key={i} className={clsx("num bg-slate-50 px-3 py-2.5 text-right dark:bg-white/[0.03]", tone(qq[view]))}>{cell(qq[view], null, `Q${i + 1} ${y}`, i * 3 + 1, i * 3 + 3)}</td>)}
                    <td className={clsx("num bg-brand-50 px-3 py-2.5 text-right font-bold dark:bg-brand-400/10", tone(team.year[view]))}>{cell(team.year[view], null, String(y), 1, 12)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </Card>
        </>
      )}
      <LedgerDrawer target={drill} onClose={() => setDrill(null)} />
    </>
  );
}
