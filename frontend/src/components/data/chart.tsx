import { BarChart3, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Tip } from "../ui/tooltip";

/**
 * Chart styling read from the CSS tokens, so Recharts follows light and dark mode.
 * Rules (dataviz skill): series colours in fixed order (never cycled), one y-axis, thin bars with a 4 px rounded top,
 * 2 px lines, hairline solid grid, text in text colours (never the series colour), a legend for 2+ series.
 */
export function useChartTheme() {
  const { resolved } = useTheme();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const muted = v("--muted-foreground"), grid = v("--chart-grid"), surface = v("--card");
    return {
      mode: resolved,
      series: Array.from({ length: 8 }, (_, i) => v(`--chart-${i + 1}`)),
      /** For series that mean good / pending / bad. Never mixed with `series` in one chart. */
      status: { good: v("--chart-good"), pending: v("--chart-pending"), critical: v("--chart-critical") },
      grid, muted, surface,
      axis: { tick: { fill: muted, fontSize: 12 }, axisLine: false, tickLine: false } as const,
      gridProps: { vertical: false, stroke: grid } as const,
      bar: { radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 24 },
      line: { strokeWidth: 2, dot: false, activeDot: { r: 5, strokeWidth: 2, stroke: surface } },
      cursor: { fill: v("--muted"), opacity: 0.7 },
    };
  }, [resolved]);
}

interface TipRow { name?: string | number; value?: unknown; color?: string; dataKey?: unknown }

/** Hover card for Recharts: <Tooltip content={<ChartTooltip format={(v) => …} />} cursor={theme.cursor} />. */
export function ChartTooltip({ active, payload, label, format }: {
  active?: boolean; payload?: ReadonlyArray<TipRow>; label?: ReactNode; format?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1.5 font-semibold text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="num ml-auto pl-4 font-medium text-foreground">
            {format && typeof p.value === "number" ? format(p.value, String(p.name)) : String(p.value ?? "—")}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Legend above the plot. Text stays in text colour; the swatch beside it carries the series colour. */
export function ChartLegend({ items, className }: { items: { name: string; color: string; kind?: "box" | "line" }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.name} className="inline-flex items-center gap-1.5">
          <span className={cn("shrink-0", i.kind === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]")} style={{ background: i.color }} aria-hidden />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * A chart in a card, with title, description, actions and a built-in table view (every chart has one, so the
 * numbers are readable without colour and copy-able).
 */
export function ChartCard({ title, description, actions, legend, table, height = 280, children, className }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; legend?: ReactNode; height?: number;
  table?: { columns: string[]; rows: (string | number)[][] }; children: ReactNode; className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("card flex flex-col p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table && (
            <div className="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Show as">
              {([["chart", BarChart3, "Chart"], ["table", Table2, "Table"]] as const).map(([k, Icon, name]) => (
                <Tip key={k} content={`${name} view`}>
                  <button type="button" aria-pressed={view === k} aria-label={`${name} view`} onClick={() => setView(k)}
                    className={cn("grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      view === k && "bg-card text-foreground shadow-xs")}>
                    <Icon className="size-4" />
                  </button>
                </Tip>
              ))}
            </div>
          )}
        </div>
      </div>
      {view === "chart" ? (
        <>
          {legend && <div className="mb-3">{legend}</div>}
          <div style={{ height }} className="min-w-0">{children}</div>
        </>
      ) : (
        <div className="-mx-5 overflow-auto" style={{ maxHeight: height + 40 }}>
          <table className="w-full text-sm">
            <thead><tr>{table!.columns.map((c, i) => <th key={c} scope="col" className={cn("sticky top-0 border-b border-border bg-muted px-5 py-2 text-xs font-medium text-muted-foreground", i ? "text-right" : "text-left")}>{c}</th>)}</tr></thead>
            <tbody>{table!.rows.map((r, ri) => (
              <tr key={ri} className="border-b border-border last:border-0">
                {r.map((cell, ci) => <td key={ci} className={cn("px-5 py-2", ci ? "num text-right" : "font-medium")}>{cell}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
