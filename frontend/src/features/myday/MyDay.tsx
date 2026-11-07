import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "@/api/client";
import { todayQuery } from "@/api/queries";
import type { Sheet } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Avatar } from "@/components/Brand";
import DownloadExcel from "@/components/DownloadExcel";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, dow, fmt, weekStartOf } from "../log/util";
import { DayView } from "./DayView";
import { HistoryView } from "./HistoryView";
import { PlanView } from "./PlanView";

/**
 * My Day (SRS v0.5 FR-G5, §10.5 "My Day: plan grid, slot log"): Day logs each hour against the approved plan; Plan makes
 * the week's plan and sends it for approval; History keeps every week. Supervisors, admins and management can open
 * anyone's day; members see their own.
 */

type Tab = "day" | "plan" | "history";
const SUBTITLE: Record<Tab, string> = {
  day: "Confirm your planned hours and log the rest. Only output hours count.",
  plan: "Plan your week hour by hour and send it for approval. Approved hours are binding.",
  history: "Every week you planned or logged, with the plan against what was done.",
};

export default function MyDay() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = useQuery(todayQuery);
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: async () => (await api.get<Sheet[]>("/team/sheets/")).data });
  const works = useMemo(() => (sheets.data ?? []).filter((s) => s.kind === "work" && !s.archived).sort((a, b) => Number(b.mine) - Number(a.mine) || a.position - b.position), [sheets.data]);
  const seesTeam = user?.role === "admin" || user?.role === "supervisor" || user?.role === "viewer";
  const asked = Number(params.get("work") ?? params.get("sheet")) || null;
  const own = works.find((s) => s.mine);
  const work = (seesTeam ? works.find((s) => s.id === asked) : undefined) ?? own ?? (seesTeam ? works[0] : undefined);
  const tab = (["day", "plan", "history"].includes(params.get("tab") ?? "") ? params.get("tab") : "day") as Tab;
  const t = today.data;
  const legacyMonth = params.get("month");
  const day = params.get("day") ?? (legacyMonth && t && legacyMonth !== t.today.slice(0, 7) ? `${legacyMonth}-01` : t?.today ?? "");

  const go = (next: { day?: string; tab?: string; work?: string }) => {
    const p = new URLSearchParams(params);
    ["month", "sheet"].forEach((k) => p.delete(k));
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    setParams(p, { replace: true });
  };

  if (sheets.isLoading || today.isLoading) return <PageSkeleton />;
  if (sheets.error || today.error) return <ErrorState error={sheets.error || today.error} onRetry={() => { sheets.refetch(); today.refetch(); }} />;
  if (!work || !t) {
    return (
      <>
        <PageHeader title="My Day" />
        <div className="card"><EmptyState icon={<CalendarClock />} title="No daily log yet"
          action={user?.role === "admin" ? <Button asChild><Link to="/admin/settings">Set up daily logs</Link></Button> : undefined}>
          {user?.role === "admin" ? "Give each person a daily log in Team setup; their plan is made for them on first use." : "An admin needs to set up your daily log first."}
        </EmptyState></div>
      </>
    );
  }

  const startDow = dow(t.week_start);
  const ws = weekStartOf(day, startDow);
  const person = work.person || work.owner_name || work.name;
  const label = `Week of ${fmt(ws, { day: "numeric", month: "short" })} – ${fmt(addDays(ws, 6), { day: "numeric", month: "short", year: "numeric" })}`;
  const thisWeek = weekStartOf(t.today, startDow);

  return (
    <>
      <PageHeader title={work.mine ? "My Day" : `${person}'s day`} subtitle={SUBTITLE[tab]}
        actions={<>
          {seesTeam && (
            <Combobox className="w-60" aria-label="Whose day" searchPlaceholder="Search people…" value={String(work.id)}
              onChange={(v) => v && go({ work: v })}
              options={works.map((s) => ({ value: String(s.id), label: s.person || s.owner_name || s.name, group: s.mine ? "You" : "Team",
                hint: s.role_name ?? undefined, icon: <Avatar name={s.person || s.owner_name || s.name} size="xs" /> }))} />
          )}
          <DownloadExcel year={+day.slice(0, 4)} sheet={work.id} />
        </>} />

      <Tabs value={tab} onValueChange={(v) => go({ tab: v })}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        {tab !== "history" && (
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => go({ day: addDays(day, -7) })}><ChevronLeft /></Button>
            <Button variant="secondary" size="icon" aria-label="Next week" onClick={() => go({ day: addDays(day, 7) })}><ChevronRight /></Button>
            <span className="ml-1 text-sm font-semibold">{label}</span>
            {ws !== thisWeek ? <Button variant="ghost" size="sm" onClick={() => go({ day: t.today })}>This week</Button>
              : tab === "plan" && <Button variant="ghost" size="sm" onClick={() => go({ day: addDays(thisWeek, 7) })}>Next week</Button>}
          </div>
        )}
      </div>

      <TabsContent value="day"><DayView key={work.id} work={work} day={day} weekStartDow={startDow} go={go} /></TabsContent>
      <TabsContent value="plan"><PlanView key={work.id} work={work} day={day} go={go} /></TabsContent>
      <TabsContent value="history"><HistoryView work={work} go={go} /></TabsContent>
      </Tabs>
    </>
  );
}
