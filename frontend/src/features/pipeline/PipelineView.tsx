import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Briefcase, Download, Kanban, List, MoreHorizontal, Plus, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, downloadFile, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import { DataTable } from "@/components/data/data-table";
import { KanbanBoard, KanbanCard, KanbanColumn } from "@/components/data/kanban";
import { StatCard } from "@/components/data/stat-card";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, money } from "@/lib/format";
import { useLocalState } from "@/lib/use-local-state";
import { cn } from "@/lib/utils";
import { configQuery, missingFor, orderedStages, recordsQuery, refreshPipeline, type PipelineRecord, type Stage } from "./api";
import { AddRecordDialog, MoveDialog, movedToast } from "./dialogs";
import { RecordSheet } from "./RecordSheet";

type Filter = "all" | "attention" | "open";
const STAGE_DOT: Record<Stage["kind"], string> = { open: "var(--color-primary)", won: "var(--color-success)", lost: "var(--color-danger)" };

function dueOf(r: PipelineRecord, today: string) {
  if (r.stage_kind !== "open" || !r.next_follow_up) return { text: undefined, tone: "neutral" as const };
  const tone = r.next_follow_up < today ? "danger" as const : r.next_follow_up === today ? "warning" as const : "neutral" as const;
  return { text: r.next_follow_up === today ? "Today" : date(r.next_follow_up, "short"), tone };
}

/** My Pipeline (SRS v0.5 FR-K1, FR-K9–K11): a board by stage (drag a card to move it) and a list. Weekly KPIs are worked
 * out from these moves, so there are no counters to type. */
export default function PipelineView({ openId, clearOpen }: { openId?: number | null; clearOpen?: () => void }) {
  const qc = useQueryClient();
  const config = useQuery(configQuery);
  const records = useQuery(recordsQuery);
  const today = useQuery(todayQuery).data?.today ?? "";
  const [view, setView] = useLocalState<"board" | "list">("pipeline-view", "board");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [openRec, setOpenRec] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ r: PipelineRecord; to: Stage } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (openId) { setOpenRec(openId); clearOpen?.(); } }, [openId, clearOpen]);

  const stages = useMemo(() => orderedStages(config.data?.stages ?? []), [config.data]);
  const byKey = useMemo(() => Object.fromEntries((config.data?.stages ?? []).map((s) => [s.key, s])), [config.data]);
  const move = useMutation({
    mutationFn: async ({ r, to }: { r: PipelineRecord; to: Stage }) => (await api.patch<PipelineRecord>(`/tracker/prospects/${r.id}/`, { stage: to.key })).data,
    onSuccess: (rec, { r, to }) => { refreshPipeline(qc); movedToast(rec, byKey[r.stage], to); },
    onError: (e) => toast.error("Couldn't move it", { description: errorText(e) }),
  });
  const requestMove = (r: PipelineRecord, to: Stage) => {
    if (r.stage === to.key) return;
    if (missingFor(to, r, config.data).length) setMoving({ r, to });
    else move.mutate({ r, to });
  };
  const imp = useMutation({
    mutationFn: async (f: File) => { const b = new FormData(); b.append("file", f); return (await api.post<{ added: number; skipped: number; unknown_stages: string[] }>("/tracker/prospects/import/", b)).data; },
    onSuccess: (r) => {
      refreshPipeline(qc);
      toast.success(`Imported ${r.added} ${r.added === 1 ? "record" : "records"}`, { duration: 8000, description: [r.skipped && `${r.skipped} skipped (duplicates or no company).`,
        r.unknown_stages.length && `Stages not recognised, put at the first stage: ${r.unknown_stages.join(", ")}.`, "Imported records don't count as this week's KPIs."].filter(Boolean).join(" ") });
    },
    onError: (e) => toast.error("Couldn't import the file", { description: errorText(e) }),
  });

  const all = records.data ?? [];
  const needsAttention = (r: PipelineRecord) => r.health != null && r.health.state !== "good";
  const shown = all.filter((r) => (filter !== "attention" || needsAttention(r)) && (filter !== "open" || r.stage_kind === "open")
    && (!q || [r.company, r.requirement, r.contact, r.next_action, r.segment, r.notes].join(" ").toLowerCase().includes(q.toLowerCase())));
  const openRecs = all.filter((r) => r.stage_kind === "open");
  const pipeValue = openRecs.reduce((s, r) => s + (+(r.value ?? 0)), 0);
  const weighted = openRecs.reduce((s, r) => s + (+(r.value ?? 0)) * r.probability / 100, 0);
  const attention = all.filter(needsAttention).length;
  const cur = config.data?.currency ?? "BDT";
  const opened = all.find((r) => r.id === openRec) ?? null;

  const columns = useMemo<ColumnDef<PipelineRecord, any>[]>(() => [   // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: "company", header: "Client", accessorFn: (r) => r.company, cell: ({ row: { original: r } }) => (
      <div className="min-w-0"><div className="truncate font-medium">{r.company}</div><div className="truncate text-xs text-muted-foreground">{r.requirement}</div></div>) },
    { id: "stage", header: "Stage", accessorFn: (r) => byKey[r.stage]?.position ?? 0, cell: ({ row: { original: r } }) => (
      <Badge tone={r.stage_kind === "won" ? "success" : r.stage_kind === "lost" ? "danger" : "primary"}>{r.stage_name}</Badge>), meta: { label: "Stage" } },
    { id: "value", header: `Value (${cur})`, accessorFn: (r) => (r.value == null ? null : +r.value), meta: { numeric: true },
      cell: ({ getValue }) => getValue() == null ? <span className="text-subtle-foreground">—</span> : money(getValue() as number, { currency: null }) },
    { id: "next", header: "Next step", accessorFn: (r) => r.next_follow_up ?? "", cell: ({ row: { original: r } }) => {
      const d = dueOf(r, today);
      return r.stage_kind !== "open" ? <span className="text-subtle-foreground">—</span> : (
        <div className="min-w-0"><div className={cn("text-xs font-medium", d.tone === "danger" ? "text-danger-text" : d.tone === "warning" ? "text-warning-text" : "")}>{d.text}</div>
          <div className="truncate text-xs text-muted-foreground">{r.next_action}</div></div>);
    } },
    { id: "health", header: "Health", accessorFn: (r) => r.health?.label ?? "", cell: ({ row: { original: r } }) => r.health
      ? <span className={cn("text-xs", r.health.state === "danger" ? "text-danger-text" : r.health.state === "warning" ? "text-warning-text" : "text-success-text")}>{r.health.label}</span>
      : <span className="text-subtle-foreground">—</span> },
    { id: "contact", header: "Last contact", accessorFn: (r) => r.last_contacted ?? "", cell: ({ getValue }) => getValue() ? date(getValue() as string, "short") : "—" },
    { id: "segment", header: "Segment", accessorFn: (r) => r.segment },
  ], [byKey, cur, today]);

  if (config.error || records.error) return <ErrorState error={config.error ?? records.error} onRetry={() => { config.refetch(); records.refetch(); }} />;
  if (!config.data || !records.data) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  const cfg = config.data;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground sm:hidden">
        <b className="font-semibold text-foreground">{openRecs.length}</b> open · <b className="font-semibold text-foreground">{money(pipeValue, { compact: true, currency: cur })}</b> in the pipeline
        · <b className={cn("font-semibold", attention ? "text-warning-text" : "text-foreground")}>{attention}</b> need attention
      </p>
      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
        <StatCard label="Open records" value={openRecs.length} icon={<Briefcase />} footer={`${all.length - openRecs.length} won or lost`} />
        <StatCard label="Open pipeline" value={money(pipeValue, { compact: true, currency: cur })} footer={`${money(weighted, { compact: true, currency: cur })} weighted by stage probability`} />
        <StatCard label="Need attention" value={attention} icon={<AlertTriangle />} footer={attention ? "Overdue, stuck or quiet records" : "Every open record is on track"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-64" placeholder="Search records…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search records" />
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ key: "all", label: "All" }, { key: "open", label: "Open" },
          { key: "attention", label: "Needs attention", count: attention }]} />
        <Segmented label="View" value={view} onChange={setView} options={[{ key: "board", label: "Board", icon: <Kanban /> }, { key: "list", label: "List", icon: <List /> }]} />
        <div className="ml-auto flex gap-2">
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) imp.mutate(f); }} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="Import or export" busy={imp.isPending}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => file.current?.click()}><Upload /> Import CSV (Odoo, Apollo…)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadFile("/tracker/prospects/export/", "pipeline.csv")}><Download /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setAdding(true)}><Plus /> Add record</Button>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="card"><EmptyState icon={<Briefcase />} title="No pipeline records yet" action={<Button onClick={() => setAdding(true)}><Plus /> Add your first record</Button>}>
          Add each qualified lead or opportunity here. Your weekly KPIs are counted from the stages they reach, so there's nothing to type at the end of the week.
        </EmptyState></div>
      ) : view === "board" ? (
        <KanbanBoard>
          {stages.map((s) => {
            const cards = shown.filter((r) => r.stage === s.key).sort((a, b) => (a.next_follow_up ?? "9").localeCompare(b.next_follow_up ?? "9"));
            const total = cards.reduce((t, r) => t + (+(r.value ?? 0)), 0);
            return (
              <div key={s.key} onDragOver={(e) => { e.preventDefault(); setOver(s.key); }} onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const r = all.find((x) => x.id === Number(e.dataTransfer.getData("text/record"))); if (r) requestMove(r, s); }}
                className={cn("shrink-0 rounded-xl transition-shadow", over === s.key && "ring-2 ring-primary")}>
                <KanbanColumn title={s.name} count={cards.length} color={STAGE_DOT[s.kind]} summary={total ? money(total, { compact: true, currency: null }) : undefined}>
                  {cards.map((r) => {
                    const d = dueOf(r, today);
                    return (
                      <KanbanCard key={r.id} title={r.company} subtitle={r.requirement || r.next_action} onClick={() => setOpenRec(r.id)}
                        onDragStart={(e) => { e.dataTransfer.setData("text/record", String(r.id)); e.dataTransfer.effectAllowed = "move"; }}
                        value={r.value != null ? money(+r.value, { compact: true, currency: null }) : undefined} due={d.text} dueTone={d.tone}
                        healthState={r.health?.state} tags={(r.stage_kind === "won" && !r.verified) || r.framework?.flagged || r.framework?.waiting ? <>
                          {r.stage_kind === "won" && !r.verified && <Badge tone="warning">Awaiting verification</Badge>}
                          {r.framework?.flagged && <Badge tone="warning">Stage review</Badge>}
                          {!!r.framework?.waiting && <Badge tone="neutral">Steps waiting</Badge>}
                        </> : undefined} />
                    );
                  })}
                  {!cards.length && <p className="px-2 py-6 text-center text-xs text-subtle-foreground">{s.kind === "open" ? "Drop a record here" : "None yet"}</p>}
                </KanbanColumn>
              </div>
            );
          })}
        </KanbanBoard>
      ) : (
        <DataTable label="Pipeline records" columns={columns} data={shown} getRowId={(r) => String(r.id)} onRowClick={(r) => setOpenRec(r.id)}
          initialSorting={[{ id: "next", desc: false }]} exportName="pipeline" pageSize={50} />
      )}
      {view === "board" && all.length > 0 && <p className="text-xs text-muted-foreground">Drag a card to another stage, or open it and pick the stage. Moving back is flagged for your supervisor.</p>}

      <RecordSheet record={opened} config={cfg} onClose={() => setOpenRec(null)} onMove={requestMove} />
      <MoveDialog record={moving?.r ?? null} to={moving?.to ?? null} from={moving ? byKey[moving.r.stage] : undefined} config={cfg} onClose={() => setMoving(null)} />
      <AddRecordDialog open={adding} onOpenChange={setAdding} config={cfg} onAdded={(r) => setOpenRec(r.id)} />
    </div>
  );
}
