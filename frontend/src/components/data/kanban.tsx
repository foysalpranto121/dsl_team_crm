import { AlertCircle, AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "../Brand";
import { Tip } from "../ui/tooltip";

/** Pipeline board building blocks. Drag and drop between stages is added in M2 (@dnd-kit) on top of these. */

export function KanbanBoard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0", className)}>{children}</div>;
}

export function KanbanColumn({ title, count, summary, color, children, footer, className }: {
  title: string; count: number; summary?: ReactNode; color?: string; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <section aria-label={`${title}, ${count} ${count === 1 ? "deal" : "deals"}`}
      className={cn("flex w-72 shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/50 p-2", className)}>
      <header className="flex items-center gap-2 px-2 pb-2 pt-1">
        {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <span className="rounded-full bg-card px-1.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">{count}</span>
        {summary && <span className="ml-auto text-xs text-muted-foreground">{summary}</span>}
      </header>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
      {footer && <div className="mt-2">{footer}</div>}
    </section>
  );
}

export type Health = "good" | "warning" | "danger";
const health: Record<Health, { Icon: typeof CheckCircle2; cls: string; text: string }> = {
  good: { Icon: CheckCircle2, cls: "text-success-text", text: "On track" },
  warning: { Icon: AlertTriangle, cls: "text-warning-text", text: "Needs attention" },
  danger: { Icon: AlertCircle, cls: "text-danger-text", text: "Stuck" },
};

/** One deal. Health uses a different icon per state as well as colour (SRS FR-SP5). */
export function KanbanCard({ title, subtitle, value, due, dueTone = "neutral", healthState, owner, tags, onClick, onDragStart, className }: {
  title: string; subtitle?: string; value?: ReactNode; due?: string; dueTone?: "neutral" | "warning" | "danger"; healthState?: Health;
  owner?: { name: string; src?: string | null }; tags?: ReactNode; onClick?: () => void;
  /** Makes the card draggable (to another stage). The card itself is the drag source: browsers won't start a drag from a button inside a draggable wrapper. */
  onDragStart?: (e: DragEvent<HTMLElement>) => void; className?: string;
}) {
  const h = healthState ? health[healthState] : null;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} draggable={onDragStart ? true : undefined} onDragStart={onDragStart}
      className={cn("w-full rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-[box-shadow,border-color]", onDragStart && "cursor-grab active:cursor-grabbing",
        onClick && "hover:border-input hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", className)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {h && (
          <Tip content={h.text}>
            <span className={cn("mt-0.5 shrink-0", h.cls)}><h.Icon className="size-4" aria-hidden /><span className="sr-only">{h.text}</span></span>
          </Tip>
        )}
      </div>
      {tags && <div className="mt-2 flex flex-wrap gap-1">{tags}</div>}
      {(value || due || owner) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {value && <span className="font-semibold text-foreground">{value}</span>}
          {due && (
            <span className={cn("inline-flex items-center gap-1", dueTone === "danger" ? "font-medium text-danger-text" : dueTone === "warning" ? "font-medium text-warning-text" : "text-muted-foreground")}>
              <CalendarClock className="size-3.5" aria-hidden />{due}
            </span>
          )}
          {owner && <span className="ml-auto"><Avatar name={owner.name} src={owner.src} size="xs" /></span>}
        </div>
      )}
    </Comp>
  );
}
