import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlarmClock, AlertTriangle, CalendarCheck2, Clock, Coins, LayoutDashboard, Star, Target } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorText } from "../api/client";
import type { DashboardRow, Gap, Pace, Today } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Announcements, Leaderboard } from "../components/DashboardExtras";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const dayFmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export const PACE: Record<Pace["key"], { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  met: { label: "Target met", tone: "green" }, onpace: { label: "On pace", tone: "green" }, near: { label: "Near", tone: "amber" },
  behind: { label: "Behind", tone: "red" }, below: { label: "Below", tone: "red" }, early: { label: "Not started", tone: "slate" }, none: { label: "No target", tone: "slate" },
};

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

function useCountdown(seconds?: number) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (seconds === undefined) return;
    const end = Date.now() + seconds * 1000;
    setLeft(seconds);
    const t = setInterval(() => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000))), 30_000);
    return () => clearInterval(t);
  }, [seconds]);
  return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
}

function Kpi({ icon, label, value, target, unit, foot }: { icon: ReactNode; label: string; value: number; target: number; unit?: string; foot?: string }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
        <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-600 [&>svg]:size-4 dark:bg-white/10 dark:text-brand-200">{icon}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num text-3xl font-medium">{unit === "money" ? money.format(value) : nf.format(value)}</span>
        {target > 0 && <span className="text-sm text-slate-500">of {unit === "money" ? money.format(target) : nf.format(target)}</span>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" role="img" aria-label={`${Math.round(pct)}% of target`}>
        <div className={clsx("h-full rounded-full transition-[width] duration-500", pct >= 100 ? "bg-emerald-500" : "bg-brand-600 dark:bg-brand-300")} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{target > 0 ? `${Math.round((value / target) * 100)}% of target` : "No target set"}{foot ? ` · ${foot}` : ""}</div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const dark = useIsDark();
  const today = useQuery({ queryKey: ["today"], queryFn: async () => (await api.get<Today>("/team/today/")).data, refetchInterval: 300_000 });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await api.get<{ date: string; rows: DashboardRow[]; gaps: Gap[] }>("/team/dashboard/")).data });
  const countdown = useCountdown(today.data?.seconds_to_lock);

  if (dash.isLoading || today.isLoading) return <Spinner />;
  if (dash.error || today.error) return <Alert>{errorText(dash.error || today.error)}</Alert>;
  const rows = dash.data!.rows, gaps = dash.data!.gaps, t = today.data!;
  const sum = (f: (r: DashboardRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const unfilled = t.my_sheets.filter((s) => s.kind === "work" && !s.filled_today);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const axis = dark ? "#9aa7bf" : "#5b6880", grid = dark ? "rgba(255,255,255,.08)" : "#e2e8f0";
  const colors = { now: dark ? "#7aa9e2" : "#034ea1", last: dark ? "#0b57ae" : "#adcbef", target: "#00a550" };   // DSL blue, light blue, DSL green
  const short = (r: DashboardRow) => (r.person || r.name).split(" ")[0];
  const hoursData = rows.map((r) => ({ name: short(r), "This week": r.week_hours, "Last week": r.last_week_hours, Target: r.week_target }));
  const pointsData = rows.map((r) => ({ name: short(r), "This month": r.month_points, "Last month": r.last_month_points, Target: r.month_target }));
  const tooltip = { contentStyle: { background: dark ? "#101d35" : "#fff", border: `1px solid ${grid}`, borderRadius: 12, fontSize: 12 }, cursor: { fill: dark ? "rgba(255,255,255,.04)" : "#f1f5f9" } };

  return (
    <>
      <PageHeader title={`${hello}, ${(user?.name || "").split(" ")[0] || "there"}`}
        subtitle={<>{dayFmt(t.today)} · Week {t.week_no} · times in {t.timezone.replace("_", " ")}</>}
        actions={<Link to="/sheets"><Button><CalendarCheck2 className="size-4" /> Fill in today</Button></Link>} />

      <Announcements />

      {t.lock_days && unfilled.length > 0 && (
        <div className="mb-6"><Alert tone="amber">
          <span className="inline-flex items-center gap-2 font-semibold"><AlarmClock className="size-4" /> You haven't filled in today yet.</span>{" "}
          Today locks at midnight, in <b className="num">{countdown}</b>. <Link to="/sheets" className="font-semibold underline">Open your sheet</Link>
        </Alert></div>
      )}

      {gaps.length > 0 && (
        <div className="mb-6"><Alert tone="amber">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Weekly results missing</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {gaps.map((g) => <li key={g.sheet}><b>{g.person}</b>: {g.weeks.length} {g.weeks.length === 1 ? "week" : "weeks"}, most recent the week of {dayFmt(g.weeks[g.weeks.length - 1])}</li>)}
          </ul>
          <Link to="/kpi" className="mt-2 inline-block font-semibold underline">Enter the weekly results</Link>
        </Alert></div>
      )}

      {rows.length === 0 ? (
        <Card><EmptyState icon={<LayoutDashboard />} title="No team sheets yet"
          action={user?.role === "admin" ? <Link to="/admin/settings"><Button>Set up sheets</Button></Link> : undefined}>
          {user?.role === "admin" ? "Create a sheet for each person, set their targets and job role, and the dashboard fills itself."
            : "An admin needs to create the team's sheets. Once they do, everyone's numbers appear here."}
        </EmptyState></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<Clock />} label="Team hours this week" value={sum((r) => r.week_hours)} target={sum((r) => r.week_target)} foot={`last week ${sum((r) => r.last_week_hours)}`} />
            <Kpi icon={<Star />} label="Points this month" value={sum((r) => r.month_points)} target={sum((r) => r.month_target)} />
            <Kpi icon={<Target />} label="Leads this month" value={sum((r) => r.kpi_month.leads)} target={sum((r) => r.kpi_targets.leads)} foot={`${sum((r) => r.kpi_month.clients)} clients`} />
            <Kpi icon={<Coins />} label="Revenue this month (BDT)" value={sum((r) => r.kpi_month.revenue)} target={sum((r) => r.kpi_targets.revenue)} unit="money" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            {([["Hours per person", "Saturday to Friday", hoursData, ["This week", "Last week"]],
               ["Points per person", "This calendar month", pointsData, ["This month", "Last month"]]] as const).map(([title, sub, data, [a, b]]) => (
              <Card key={title} className="p-5">
                <div className="mb-4"><h2 className="text-base font-bold">{title}</h2><p className="text-xs text-slate-500">{sub} · green bar is the target</p></div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data as unknown as Record<string, number | string>[]} barGap={3} margin={{ left: -16, right: 8 }}>
                      <CartesianGrid vertical={false} stroke={grid} />
                      <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltip} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey={a} fill={colors.now} radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey={b} fill={colors.last} radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="Target" fill={colors.target} radius={[6, 6, 0, 0]} maxBarSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ))}
          </div>

          <Leaderboard />

          <Card className="mt-6 overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5"><h2 className="text-base font-bold">Team status</h2>
              <p className="text-xs text-slate-500">Status compares with where each person should be by today</p></div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
                  {["Person", "Today", "Week hours", "Week", "Month points", "Month", "Leads", "Avg / week"].map((h) => <th key={h} className="px-5 py-2.5 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                      <td className="px-5 py-3"><div className="font-semibold">{r.person || r.name}</div><div className="text-xs text-slate-500">{r.role || "No job role"}</div></td>
                      <td className="num px-5 py-3">{r.today_hours ? `${r.today_hours} h` : <span className="text-slate-400">—</span>}</td>
                      <td className="num px-5 py-3">{r.week_hours} / {nf.format(r.week_target)}</td>
                      <td className="px-5 py-3"><Badge tone={PACE[r.week_status.key].tone}>{PACE[r.week_status.key].label}</Badge></td>
                      <td className="num px-5 py-3">{nf.format(r.month_points)} / {nf.format(r.month_target)}</td>
                      <td className="px-5 py-3"><Badge tone={PACE[r.month_status.key].tone}>{PACE[r.month_status.key].label}</Badge></td>
                      <td className="num px-5 py-3">{r.kpi_month.leads} / {nf.format(r.kpi_targets.leads)}</td>
                      <td className="num px-5 py-3">{r.avg_week_hours ?? <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
