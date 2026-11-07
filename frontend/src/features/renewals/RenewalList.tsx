import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarSync } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { Avatar } from "@/components/Brand";
import { DataTable } from "@/components/data/data-table";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { date, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KEY, STAGE_TONE, endsText, urgency, type Renewal } from "./types";

type Show = "open" | "won" | "lost" | "all";
const SHOWS: { key: Show; label: string }[] = [{ key: "open", label: "To renew" }, { key: "won", label: "Renewed" }, { key: "lost", label: "Not renewing" }, { key: "all", label: "All" }];
const isOpen = (r: Renewal) => r.due !== null;

export function FilterChips<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; options: { key: K; label: string; count?: number }[]; label: string;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            value === o.key && "bg-card text-foreground shadow-xs")}>
          {o.label}{o.count != null && <span className="num text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function NextStep({ r }: { r: Renewal }) {
  if (r.stage === "won") return <span className="text-muted-foreground">Renewed {date(r.closed_on, "short")}</span>;
  if (r.stage === "lost") return <span className="text-muted-foreground">{r.lost_reason}</span>;
  return (
    <div className="min-w-0">
      <div className="truncate text-foreground">{r.next_action || "—"}</div>
      <div className={cn("text-xs", r.due === "overdue" ? "font-medium text-danger-text" : r.due === "today" ? "font-medium text-warning-text" : "text-muted-foreground")}>
        {r.due === "overdue" ? `Overdue since ${date(r.next_action_on, "short")}` : r.due === "today" ? "Due today" : `By ${date(r.next_action_on, "short")}`}
      </div>
    </div>
  );
}

export function RenewalList({ seesAll, firstWindow, lastWindow, onOpen, onAddContracts }: {
  seesAll: boolean; firstWindow: number; lastWindow: number; onOpen: (id: number) => void; onAddContracts?: () => void;
}) {
  const [show, setShow] = useState<Show>("open");
  const q = useQuery({ queryKey: [...KEY, "opportunities"], queryFn: async () => (await api.get<Renewal[]>("/renewals/opportunities/?show=all")).data });
  const all = q.data ?? [];
  const rows = useMemo(() => all.filter((r) => show === "all" || (show === "open" ? isOpen(r) : r.stage === show)), [all, show]);

  const columns = useMemo<ColumnDef<Renewal, any>[]>(() => [
    { id: "client", accessorFn: (r) => r.contract.client, header: "Client", enableHiding: false,
      cell: (c) => <div className="min-w-0"><div className="truncate font-medium text-foreground">{c.row.original.contract.client}</div>
        <div className="truncate text-xs text-muted-foreground">{c.row.original.contract.product}</div></div> },
    { id: "ends", accessorFn: (r) => r.contract.end_date, header: "Ends",
      cell: (c) => { const r = c.row.original; return (
        <div className="whitespace-nowrap"><div>{date(r.contract.end_date)}</div>
          {isOpen(r) && <Badge tone={urgency(r.days_left, lastWindow)} className="mt-1">{endsText(r.days_left)}</Badge>}</div>); } },
    { id: "value", accessorFn: (r) => +r.value, header: "Value", meta: { numeric: true }, cell: (c) => money(c.getValue()) },
    { id: "stage", accessorFn: (r) => r.stage_label, header: "Stage", cell: (c) => <Badge tone={STAGE_TONE[c.row.original.stage]}>{c.getValue()}</Badge> },
    { id: "next", accessorFn: (r) => (isOpen(r) ? r.next_action : r.stage === "lost" ? r.lost_reason : `Renewed ${r.closed_on}`), header: "Next step",
      meta: { className: "max-w-72" }, enableSorting: false, cell: (c) => <NextStep r={c.row.original} /> },
    ...(seesAll ? [{ id: "owner", accessorFn: (r: Renewal) => r.contract.owner?.name ?? "", header: "Owner",
      cell: (c: { row: { original: Renewal } }) => { const o = c.row.original.contract.owner; return o
        ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><Avatar name={o.name} src={o.photo} size="xs" />{o.name}</span>
        : <span className="text-muted-foreground">No owner</span>; } } as ColumnDef<Renewal, any>] : []),
  ], [seesAll, lastWindow]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const count = (k: Show) => all.filter((r) => k === "all" || (k === "open" ? isOpen(r) : r.stage === k)).length;
  return (
    <DataTable label="Renewals" columns={columns} data={rows} getRowId={(r) => String(r.id)} loading={q.isLoading}
      onRowClick={(r) => onOpen(r.id)} searchPlaceholder="Search renewals…" exportName="renewals" pageSize={25}
      initialSorting={[{ id: "ends", desc: false }]}
      toolbar={<FilterChips label="Show" value={show} onChange={setShow} options={SHOWS.map((s) => ({ ...s, count: q.data ? count(s.key) : undefined }))} />}
      empty={all.length === 0 ? (
        <EmptyState icon={<CalendarSync />} title="No renewals yet"
          action={onAddContracts && <Button onClick={onAddContracts}>Add contracts</Button>}>
          A renewal appears here by itself {firstWindow} days before a contract ends{seesAll ? "" : ", for the contracts you own"}.
        </EmptyState>
      ) : <EmptyState compact icon={<CalendarSync />} title="Nothing here">No renewals match this filter.</EmptyState>} />
  );
}
