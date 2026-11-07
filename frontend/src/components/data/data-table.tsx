import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type Column, type ColumnDef, type RowData, type SortingState, type Table, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download, SearchX, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocalState } from "@/lib/use-local-state";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SearchInput } from "../ui/input";
import { Skeleton } from "../ui/skeleton";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-aligned, tabular figures: numbers, money, hours. */
    numeric?: boolean;
    /** The column's name in the column chooser and the CSV, when the header isn't plain text. */
    label?: string;
    className?: string;
  }
}

export interface DataTableProps<T> {
  /** Accessible name of the table, e.g. "Team status". */
  label: string;
  /** Columns hold different value types, hence `any` for the value. */
  columns: ColumnDef<T, any>[];
  data: T[];
  getRowId?: (row: T, index: number) => string;
  /** Makes rows clickable (and Enter-able) — open a drawer or a detail page. */
  onRowClick?: (row: T) => void;
  /** Shows a search box over every column. */
  searchPlaceholder?: string;
  /** Extra controls on the left of the toolbar (filters, tabs). */
  toolbar?: ReactNode;
  initialSorting?: SortingState;
  /** Paginate after this many rows. */
  pageSize?: number;
  /** File name for "Download CSV" (without .csv). */
  exportName?: string;
  /** Shown when there are no rows at all (a teaching EmptyState). */
  empty?: ReactNode;
  loading?: boolean;
  maxHeight?: number | string;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

const colLabel = <T,>(c: Column<T, unknown>) =>
  c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id);

function downloadCsv<T>(table: Table<T>, name: string) {
  const cols = table.getVisibleLeafColumns().filter((c) => c.accessorFn);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map((c) => esc(colLabel(c))).join(","),
    ...table.getPrePaginationRowModel().rows.map((r) => cols.map((c) => esc(r.getValue(c.id))).join(","))];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sortable, searchable table with a column chooser, comfortable/compact density, CSV download and pagination. */
export function DataTable<T>({ label, columns, data, getRowId, onRowClick, searchPlaceholder, toolbar, initialSorting, pageSize,
  exportName, empty, loading, maxHeight, rowClassName, className }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [density, setDensity] = useLocalState<"comfortable" | "compact">(`table-density:${label}`, "comfortable");

  const table = useReactTable({
    data, columns, getRowId,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageIndex: 0, pageSize } } } : {}),
  });

  const rows = table.getRowModel().rows;
  const total = table.getPrePaginationRowModel().rows.length;
  const colCount = table.getVisibleLeafColumns().length;
  const pad = density === "compact" ? "py-1.5" : "py-3";
  const { pageIndex, pageSize: size } = table.getState().pagination;

  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {searchPlaceholder && (
          <SearchInput value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder}
            aria-label={searchPlaceholder} className="w-full sm:w-64" />
        )}
        {toolbar}
        <div className="ml-auto flex items-center gap-1">
          {exportName && <Button variant="ghost" size="sm" onClick={() => downloadCsv(table, exportName)}><Download /> CSV</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="Table view options"><Settings2 /> View</Button></DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Row height</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as typeof density)}>
                <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                  {colLabel(c)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-sm" aria-label={label} aria-busy={loading || undefined}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta, sort = h.column.getIsSorted(), can = h.column.getCanSort();
                  const SortIcon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : ChevronsUpDown;
                  return (
                    <th key={h.id} scope="col" colSpan={h.colSpan}
                      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : can ? "none" : undefined}
                      className={cn("sticky top-0 z-10 h-10 whitespace-nowrap border-b border-border bg-muted px-4 text-left text-xs font-medium text-muted-foreground",
                        meta?.numeric && "text-right", meta?.className)}>
                      {h.isPlaceholder ? null : can ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()}
                          className={cn("-mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            meta?.numeric && "flex-row-reverse", sort && "text-foreground")}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <SortIcon className={cn("size-3.5", !sort && "opacity-40")} aria-hidden />
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }, (_, r) => (
              <tr key={r}>{Array.from({ length: colCount }, (_, c) => <td key={c} className={cn("border-b border-border px-4", pad)}><Skeleton className="h-4 w-full max-w-40" /></td>)}</tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={colCount}>
                {data.length === 0 && empty ? empty : (
                  <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                    <SearchX className="size-6 text-subtle-foreground" aria-hidden />
                    No rows match “{globalFilter}”.
                    {globalFilter && <Button variant="link" size="sm" onClick={() => setGlobalFilter("")}>Clear the search</Button>}
                  </div>
                )}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r.original); } : undefined}
                className={cn("group/row transition-colors hover:bg-muted/50", onRowClick && "cursor-pointer outline-hidden focus-visible:bg-primary-soft/50", rowClassName?.(r.original))}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={cn("border-b border-border px-4 align-middle group-last/row:border-b-0", pad,
                    c.column.columnDef.meta?.numeric && "num text-right", c.column.columnDef.meta?.className)}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageSize && total > size && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>Showing <b className="font-semibold text-foreground">{pageIndex * size + 1}–{Math.min(total, (pageIndex + 1) * size)}</b> of {total}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft /></Button>
            <span className="px-1">Page {pageIndex + 1} of {table.getPageCount()}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
