import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { DataTable } from "@/components/data/data-table";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { fmt, num } from "../log/util";
import type { DrillTarget } from "../scoring/api";
import { Drill, LedgerDrawer } from "../scoring/LedgerDrawer";
import { STATUS_PILL, type HistoryWeek } from "./rules";

/** My Day → History: every week kept, with plan against actual (SRS v0.5 FR-T6, FR-R1 plan adherence). */
export function HistoryView({ work, go }: { work: { id: number }; go: (next: { day?: string; tab?: string }) => void }) {
  const q = useQuery({ queryKey: ["plan-history", work.id], queryFn: async () => (await api.get<{ weeks: HistoryWeek[]; target_hours: number }>(`/team/plans/history/?work=${work.id}`)).data });
  const target = q.data?.target_hours ?? 0;
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const columns = useMemo<ColumnDef<HistoryWeek, any>[]>(() => [
    { id: "week", accessorFn: (w) => w.week_start, header: "Week", enableHiding: false, cell: (c) => { const w = c.row.original; return (
      <div><div className="font-medium text-foreground">Week {w.week_no}{w.when === "current" && <Badge tone="primary" className="ml-2">This week</Badge>}{w.when === "ahead" && <Badge tone="outline" className="ml-2">Ahead</Badge>}</div>
        <div className="text-xs text-muted-foreground">{fmt(w.week_start, { day: "numeric", month: "short" })} – {fmt(w.week_end, { day: "numeric", month: "short", year: "numeric" })}</div></div>); } },
    { id: "status", accessorFn: (w) => w.status_label, header: "Plan", cell: (c) => { const w = c.row.original; return w.status ? <StatusPill status={STATUS_PILL[w.status]}>{w.status_label}</StatusPill> : <Badge tone="outline">Not planned</Badge>; } },
    { accessorKey: "planned_hours", header: "Planned", meta: { numeric: true } },
    { accessorKey: "approved_hours", header: "Approved", meta: { numeric: true } },
    { accessorKey: "logged_hours", header: "Logged", meta: { numeric: true } },
    { accessorKey: "output_hours", header: "Output", meta: { numeric: true, label: "Output hours (counted)" },
      cell: (c) => <span>{c.getValue()}{target > 0 && <span className="text-muted-foreground"> / {num.format(target)}</span>}</span> },
    { accessorKey: "points", header: "Points", meta: { numeric: true }, cell: (c) => { const w = c.row.original; return (
      <Drill what={`week ${w.week_no}`} onClick={(e) => { e.stopPropagation(); setDrill({ title: `Week ${w.week_no}`, sheet: work.id, from: w.week_start, to: w.week_end }); }}>{num.format(c.getValue())}</Drill>); } },
    { id: "adherence", accessorFn: (w) => w.adherence ?? -1, header: "Adherence", meta: { label: "Adherence (approved hours done as planned)" },
      cell: (c) => { const a = c.row.original.adherence; return a == null ? <span className="text-subtle-foreground">—</span> : (
        <div className="flex min-w-28 items-center gap-2"><Progress value={Math.round(a * 100)} max={100} size="sm" tone={a >= 1 ? "success" : "primary"} label={`Adherence ${Math.round(a * 100)}%`} className="flex-1" />
          <span className="w-9 text-right text-xs tabular-nums">{Math.round(a * 100)}%</span></div>); } },
    { accessorKey: "reviewed_by", header: "Decided by", cell: (c) => c.getValue() ?? <span className="text-subtle-foreground">—</span> },
  ], [target, work.id]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (<>
    <DataTable label="Weeks" columns={columns} data={q.data?.weeks ?? []} loading={q.isLoading} getRowId={(w) => w.week_start} pageSize={15} exportName="my-weeks"
      onRowClick={(w) => go({ tab: "plan", day: w.week_start })}
      empty={<EmptyState icon={<History />} title="No weeks yet">Each week you plan or log shows here, with what was planned against what was done.</EmptyState>} />
    <LedgerDrawer target={drill} onClose={() => setDrill(null)} />
  </>);
}
