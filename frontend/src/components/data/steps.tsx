import { Check, Clock, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "waiting" | "failed" | "upcoming";

const stateText: Record<StepState, string> = { done: "done", current: "current step", waiting: "waiting", failed: "needs fixing", upcoming: "not started" };

/**
 * Where a multi-step item is and who it waits on (SRS FR-G4):
 * Draft → Submitted → Approved → Logged → Scored, with a note such as "Waiting for supervisor approval since 10:40".
 */
export function StepTracker({ steps, note, className }: { steps: { label: string; state: StepState }[]; note?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <ol className="flex flex-wrap items-center gap-y-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center" aria-current={s.state === "current" || s.state === "waiting" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("mx-2 h-px w-6 sm:w-10", steps[i - 1].state === "done" ? "bg-success" : "bg-border")} />}
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
              s.state === "done" && "bg-success text-white",
              s.state === "current" && "bg-primary text-primary-foreground ring-4 ring-primary-soft",
              s.state === "waiting" && "bg-warning-soft text-warning-text ring-1 ring-warning/40",
              s.state === "failed" && "bg-danger-soft text-danger-text ring-1 ring-danger/40",
              s.state === "upcoming" && "border border-input bg-card text-subtle-foreground")} aria-hidden>
              {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "waiting" ? <Clock className="size-3.5" />
                : s.state === "failed" ? <X className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("ml-2 text-[13px]", s.state === "upcoming" ? "text-muted-foreground" : "font-medium text-foreground")}>
              {s.label}<span className="sr-only"> ({stateText[s.state]})</span>
            </span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" aria-hidden />{note}</p>}
    </div>
  );
}

export interface TimelineItem {
  id: string | number;
  title: ReactNode;
  time: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
}

const dotTone = {
  primary: "bg-primary-soft text-primary-text", success: "bg-success-soft text-success-text", warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text", neutral: "bg-muted text-muted-foreground",
};

/** A vertical history: a deal's weekly status log, the audit trail of an entry, approvals. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className="absolute left-3.5 top-8 bottom-0 w-px -translate-x-1/2 bg-border" />}
          <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-card [&>svg]:size-3.5", dotTone[it.tone ?? "neutral"])} aria-hidden>
            {it.icon ?? <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-medium text-foreground">{it.title}</span>
              <span className="text-xs text-muted-foreground">{it.time}</span>
            </div>
            {it.description && <div className="mt-0.5 text-sm text-muted-foreground">{it.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
