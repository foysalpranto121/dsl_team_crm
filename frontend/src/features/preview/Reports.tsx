import { Download, FileSpreadsheet, FileText, Lightbulb } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, ChartTooltip, useChartTheme } from "@/components/data/chart";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { num } from "@/lib/format";
import { adherenceOf, avgScore, CATEGORIES, CURRENCY, METRICS, PEOPLE, ROLES, scoreOf, statusOf, sumOf, targetsFor, targetSumOf, TASKS, TURNAROUND, WEEKLY_PERFORMANCE, type PeriodKey, type RoleKey } from "./mock";
import { CardTitle, pctOf, PreviewPage, ScorePill, ScrollX, showMetric, TH, TH_NUM } from "./parts";

type ReportKey = "performance" | "tasks" | "kpi" | "adherence" | "turnaround";
const REPORTS: { key: ReportKey; name: string }[] = [{ key: "performance", name: "Performance" }, { key: "tasks", name: "Task analysis" }, { key: "kpi", name: "KPI summary" }, { key: "adherence", name: "Plan adherence" }, { key: "turnaround", name: "Approval turnaround" }];
type Cell = string | number;
interface Built { question: string; summary: string; action: string; columns: { label: string; num?: boolean }[]; rows: Cell[][]; total?: Cell[]; chart: { title: string; note: string; data: { name: string; value: number }[]; unit?: string; bars?: boolean }; fileName: string; status?: number[] }

const pts = (c: { hours: number; points: number }) => (c.hours ? num(c.points / c.hours, 1) : "—");
const roleKeys = Object.keys(ROLES) as RoleKey[];

function ReportChart({ c }: { c: Built["chart"] }) {
  const theme = useChartTheme();
  const horizontal = c.bars;
  return (
    <ChartCard title={c.title} description={c.note} height={horizontal ? Math.max(200, c.data.length * 30) : 240}>
      <ResponsiveContainer width="100%" height="100%">
        {horizontal ? (
          <BarChart data={c.data} layout="vertical" margin={{ left: 0, right: 44 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" {...theme.axis} width={150} tick={{ ...theme.axis.tick, fontSize: 11 }} interval={0} /><Tooltip content={<ChartTooltip format={(v) => `${num(v)}${c.unit ?? ""}`} />} cursor={theme.cursor} />
            <Bar dataKey="value" name={c.title} fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={16}><LabelList dataKey="value" position="right" fill={theme.muted} fontSize={11} formatter={(v: unknown) => `${num(Number(v))}${c.unit ?? ""}`} /></Bar></BarChart>
        ) : (
          <BarChart data={c.data} margin={{ left: -16, right: 8, top: 20 }}><CartesianGrid {...theme.gridProps} /><XAxis dataKey="name" {...theme.axis} interval={0} tick={{ ...theme.axis.tick, fontSize: 11 }} /><YAxis {...theme.axis} /><Tooltip content={<ChartTooltip format={(v) => `${num(v)}${c.unit ?? ""}`} />} cursor={theme.cursor} />
            <Bar dataKey="value" name={c.title} fill={theme.series[0]} {...theme.bar} maxBarSize={32}><LabelList dataKey="value" position="top" fill={theme.muted} fontSize={11} formatter={(v: unknown) => `${num(Number(v))}${c.unit ?? ""}`} /></Bar></BarChart>
        )}
      </ResponsiveContainer>
    </ChartCard>
  );
}

function downloadCsv(b: Built) {
  const esc = (v: Cell) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [b.columns.map((c) => esc(c.label)).join(","), ...b.rows.map((r) => r.map(esc).join(",")), ...(b.total ? [b.total.map(esc).join(",")] : [])];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `${b.fileName}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SRS v0.5 §5.14 on sample data: the five prebuilt reports, each with a chart, a table and an action (§1.2: every report also suggests an action). */
export default function Reports() {
  const [report, setReport] = useState<ReportKey>("performance");
  const [grain, setGrain] = useState<"weekly" | "monthly">("monthly");
  const [cut, setCut] = useState<"category" | "task">("category");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [role, setRole] = useState("all");
  const [person, setPerson] = useState("all");

  const people = useMemo(() => PEOPLE.filter((p) => (role === "all" || p.role === role) && (person === "all" || p.id === person)), [role, person]);
  const share = people.reduce((s, p) => s + p.actual.month.hours, 0) / PEOPLE.reduce((s, p) => s + p.actual.month.hours, 0);
  const whenName = period === "last" ? "September" : "October";

  const built: Built = useMemo(() => {
    if (report === "performance" && grain === "weekly") {
      const rows = WEEKLY_PERFORMANCE.map((w) => ({ ...w, hours: Math.round(w.hours * share), points: Math.round(w.points * share) }));
      const totalH = rows.reduce((s, w) => s + w.hours, 0), totalP = rows.reduce((s, w) => s + w.points, 0);
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      return { question: "How did each week go?", fileName: "performance-weekly", summary: `Last week's ${num(last.hours)} output hours were ${last.hours >= prev.hours ? "up" : "down"} ${num(Math.abs(last.hours - prev.hours))} on the week before.`,
        action: "Hours have slipped for two weeks. Check whether plans are full before approving next week's.", columns: [{ label: "Week" }, { label: "Output hours", num: true }, { label: "Points", num: true }, { label: "Points per hour", num: true }],
        rows: rows.map((w) => [w.week, w.hours, w.points, pts(w)]), total: ["Total", totalH, totalP, pts({ hours: totalH, points: totalP })], chart: { title: "Output hours", note: "By week", data: rows.map((w) => ({ name: w.week, value: w.hours })) } };
    }
    if (report === "performance") {
      const score = avgScore(people, period), other = avgScore(people, period === "last" ? "month" : "last");
      const low = [...people].sort((a, b) => scoreOf(a, period) - scoreOf(b, period))[0];
      return { question: "How did each person do this month?", fileName: `performance-${whenName.toLowerCase()}`, summary: `The average score for ${whenName} is ${pctOf(score)}, ${score >= other ? "up" : "down"} from ${pctOf(other)} ${period === "last" ? "in October" : "in September"}.`,
        action: low ? `${low.name} has the most room to grow. Open their numbers before the next one-to-one.` : "Nobody matches these filters.",
        columns: [{ label: "Person" }, ...METRICS.map((m) => ({ label: m.label, num: true })), { label: "Score", num: true }, { label: "Status" }],
        rows: people.map((p) => [p.name, ...METRICS.map((m) => showMetric(m.key, p.actual[period][m.key])), pctOf(scoreOf(p, period)), statusOf(scoreOf(p, period)).label]),
        total: people.length ? ["Team", ...METRICS.map((m) => (m.key === "hours" ? `${num(sumOf(people, period, "hours") / people.length)} avg` : showMetric(m.key, sumOf(people, period, m.key)))), pctOf(score), statusOf(score).label] : undefined,
        status: people.map((p) => scoreOf(p, period)), chart: { title: "Composite score", note: whenName, unit: "%", data: people.map((p) => ({ name: p.name.split(" ")[0], value: Math.round(scoreOf(p, period) * 100) })) } };
    }
    if (report === "tasks") {
      const scale = (v: number) => Math.round(v * share);
      if (cut === "category") {
        const rows = CATEGORIES.map((c) => ({ ...c, hours: scale(c.hours), points: scale(c.points) }));
        const totalH = rows.reduce((s, c) => s + c.hours, 0), totalP = rows.reduce((s, c) => s + c.points, 0), top = rows[0], best = [...rows].filter((c) => c.hours > 20 * share).sort((a, b) => b.points / b.hours - a.points / a.hours)[0];
        return { question: "Where did the hours go?", fileName: "task-analysis-category", summary: `${top.name} took ${pctOf(top.hours / totalH)} of the hours, against an expected ${top.expected}%.`, action: best ? `${best.name} earns the most, ${pts(best)} points an hour. See if more of the plan can move there.` : "Not enough hours to compare yet.",
          columns: [{ label: "Category" }, { label: "Hours", num: true }, { label: "Share", num: true }, { label: "Expected", num: true }, { label: "Points", num: true }, { label: "Points per hour", num: true }],
          rows: rows.map((c) => [c.name, c.hours, pctOf(c.hours / totalH), `${c.expected}%`, c.points, pts(c)]), total: ["Total", totalH, "100%", "100%", totalP, pts({ hours: totalH, points: totalP })], chart: { title: "Hours by category", note: "October", bars: true, data: rows.map((c) => ({ name: c.name, value: c.hours })) } };
      }
      const rows = TASKS.map((t) => ({ ...t, hours: scale(t.hours), points: scale(t.points) }));
      const totalH = rows.reduce((s, c) => s + c.hours, 0), totalP = rows.reduce((s, c) => s + c.points, 0), top = rows[0];
      return { question: "Which tasks took the most time?", fileName: "task-analysis-task", summary: `${top.name} is the biggest single task, ${num(top.hours)} hours.`, action: "Demo & Presentation Session earns the most per hour. Book more demos where deals are ready.",
        columns: [{ label: "Task" }, { label: "Category" }, { label: "Hours", num: true }, { label: "Points", num: true }, { label: "Points per hour", num: true }], rows: rows.map((t) => [t.name, t.category, t.hours, t.points, pts(t)]), total: ["The top 8 tasks", "", totalH, totalP, pts({ hours: totalH, points: totalP })], chart: { title: "Hours by task", note: "October", bars: true, data: rows.map((t) => ({ name: t.name, value: t.hours })) } };
    }
    if (report === "kpi") {
      const kpis = METRICS.filter((m) => m.key !== "hours" && m.key !== "points");
      const achieved = kpis.map((m) => { const t = targetSumOf(people, period, m.key); return { name: m.label, value: t ? Math.round((sumOf(people, period, m.key) / t) * 100) : 0 }; });
      const low = [...achieved].sort((a, b) => a.value - b.value)[0];
      return { question: "Are the KPIs on track?", fileName: `kpi-summary-${whenName.toLowerCase()}`, summary: `For ${whenName}, ${low?.name.toLowerCase()} ${low?.value < 100 ? `is the furthest from target, at ${low?.value}%` : "and every other KPI are on target"}.`, action: "Counts come from the pipeline, so there's nothing to type. Check any backward moves on Weekly KPI before confirming.",
        columns: [{ label: "Person" }, ...kpis.flatMap((m) => [{ label: m.label, num: true }, { label: "Target", num: true }])],
        rows: people.map((p) => [p.name, ...kpis.flatMap((m) => [showMetric(m.key, p.actual[period][m.key]), targetsFor(p.role, period)[m.key] ? showMetric(m.key, targetsFor(p.role, period)[m.key]) : "—"])]),
        total: people.length ? ["Team", ...kpis.flatMap((m) => [showMetric(m.key, sumOf(people, period, m.key)), showMetric(m.key, targetSumOf(people, period, m.key))])] : undefined, chart: { title: "Achievement", note: `${whenName}, the team against its targets`, unit: "%", data: achieved } };
    }
    if (report === "adherence") {
      const sum = (k: "approved" | "completed" | "missed" | "deviations" | "unplanned") => people.reduce((s, p) => s + p.adherence[k], 0);
      const low = [...people].sort((a, b) => adherenceOf(a) - adherenceOf(b))[0], rate = sum("approved") ? sum("completed") / sum("approved") : 0;
      return { question: "Did people do what they planned?", fileName: "plan-adherence", summary: `${pctOf(rate)} of approved hours were done as planned in October.`, action: low ? `${low.name} missed ${low.adherence.missed} approved hours. Smaller plans may help more than bigger targets.` : "Nobody matches these filters.",
        columns: [{ label: "Person" }, { label: "Approved hours", num: true }, { label: "Done", num: true }, { label: "Adherence", num: true }, { label: "Missed", num: true }, { label: "Deviations", num: true }, { label: "Unplanned", num: true }],
        rows: people.map((p) => [p.name, p.adherence.approved, p.adherence.completed, pctOf(adherenceOf(p)), p.adherence.missed, p.adherence.deviations, p.adherence.unplanned]), total: people.length ? ["Team", sum("approved"), sum("completed"), pctOf(rate), sum("missed"), sum("deviations"), sum("unplanned")] : undefined,
        chart: { title: "Adherence", note: "October", unit: "%", data: people.map((p) => ({ name: p.name.split(" ")[0], value: Math.round(adherenceOf(p) * 100) })) } };
    }
    const decided = TURNAROUND.reduce((s, w) => s + w.decided, 0), esc = TURNAROUND.reduce((s, w) => s + w.escalated, 0), last = TURNAROUND[TURNAROUND.length - 1];
    return { question: "How quickly are approvals decided?", fileName: "approval-turnaround", summary: `Last week's approvals took a median of ${num(last.median)} hours, and ${pctOf(last.inSla)} were within the SLA.`, action: "Escalations jumped in the week of 17 October. A second approver for busy weeks would keep plans moving.",
      columns: [{ label: "Week" }, { label: "Decided", num: true }, { label: "Median hours", num: true }, { label: "Within SLA", num: true }, { label: "Escalated", num: true }], rows: TURNAROUND.map((w) => [w.week, w.decided, num(w.median), pctOf(w.inSla), w.escalated]),
      total: ["Total", decided, "", pctOf(TURNAROUND.reduce((s, w) => s + w.inSla * w.decided, 0) / decided), esc], chart: { title: "Median hours to decide", note: "By week", data: TURNAROUND.map((w) => ({ name: w.week, value: w.median })) } };
  }, [report, grain, cut, period, people, share, whenName]);

  const usesPeriod = report === "kpi" || (report === "performance" && grain === "monthly");
  const usesPeople = report !== "turnaround";
  const noRows = !built.rows.length;
  const later = (kind: string) => toast(`${kind} comes from the server`, { description: "Once connected, it matches these numbers exactly. CSV works now, so you can check the columns." });
  let controls: ReactNode = null;
  if (report === "performance") controls = <div><span className="label">Show</span><Segmented label="Weekly or monthly" value={grain} onChange={setGrain} options={[{ key: "monthly", label: "Monthly" }, { key: "weekly", label: "Weekly" }]} /></div>;
  if (report === "tasks") controls = <div><span className="label">Show</span><Segmented label="By category or by task" value={cut} onChange={setCut} options={[{ key: "category", label: "By category" }, { key: "task", label: "By task" }]} /></div>;
  return (
    <PreviewPage title="Reports" subtitle={`Five ready-made reports. Currency: ${CURRENCY}. Each one ends with something to do about it.`}>
      <Tabs value={report} onValueChange={(v) => setReport(v as ReportKey)}><TabsList className="mb-4">{REPORTS.map((r) => <TabsTrigger key={r.key} value={r.key}>{r.name}</TabsTrigger>)}</TabsList></Tabs>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {controls}
        {usesPeriod && <div><span className="label">Period</span><Segmented label="Period" value={period} onChange={setPeriod} options={[{ key: "month", label: "October" }, { key: "last", label: "September" }]} /></div>}
        {usesPeople && <><Field label="Role profile" className="w-56"><NativeSelect value={role} onChange={(e) => { setRole(e.target.value); setPerson("all"); }}><option value="all">All role profiles</option>{roleKeys.map((r) => <option key={r} value={r}>{ROLES[r].name}</option>)}</NativeSelect></Field>
          <Field label="Person" className="w-44"><NativeSelect value={person} onChange={(e) => setPerson(e.target.value)}><option value="all">Everyone</option>{PEOPLE.filter((p) => role === "all" || p.role === role).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field></>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadCsv(built)} disabled={noRows}><Download /> CSV</Button>
          <Button variant="secondary" onClick={() => later("Excel")} disabled={noRows}><FileSpreadsheet /> Excel</Button>
          <Button variant="secondary" onClick={() => later("PDF")} disabled={noRows}><FileText /> PDF</Button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <section className="card p-5" aria-label="In short">
          <h2 className="text-sm font-semibold text-muted-foreground">{built.question}</h2>
          <p className="mt-1 text-base font-medium" data-summary>{built.summary}</p>
          <p className="mt-2 flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm"><Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /><span><strong className="font-medium">Suggested action:</strong> {built.action}</span></p>
        </section>
        {!noRows && <ReportChart c={built.chart} />}
        <section className="card overflow-hidden" aria-labelledby="report-table-title">
          <CardTitle id="report-table-title" title="The numbers" />
          <ScrollX label="Report table">
            <table className="w-full min-w-[36rem] text-sm" data-report-table>
              <thead><tr className="border-b border-border">{built.columns.map((c) => <th key={c.label + (c.num ? "n" : "")} scope="col" className={c.num ? TH_NUM : TH}>{c.label}</th>)}</tr></thead>
              <tbody className="tabular-nums">{built.rows.map((r, i) => (
                <tr key={i} className="border-b border-border">{r.map((cell, j) => {
                  const isStatus = built.status && built.columns[j].label === "Status";
                  return j === 0 ? <th key={j} scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">{cell}</th>
                    : <td key={j} className={built.columns[j].num ? "whitespace-nowrap px-3 py-2 text-right" : "whitespace-nowrap px-3 py-2"}>{isStatus ? <ScorePill ratio={built.status![i]} /> : cell}</td>;
                })}</tr>))}</tbody>
              {built.total && <tfoot className="tabular-nums"><tr className="bg-muted/50">{built.total.map((cell, j) => (j === 0 ? <th key={j} scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold">{cell}</th> : <td key={j} className={built.columns[j].num ? "whitespace-nowrap px-3 py-2 text-right font-semibold" : "whitespace-nowrap px-3 py-2 font-semibold"}>{cell}</td>))}</tr></tfoot>}
            </table>
          </ScrollX>
        </section>
      </div>
    </PreviewPage>
  );
}
