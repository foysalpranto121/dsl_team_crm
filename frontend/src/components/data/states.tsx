import { CloudOff, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorText } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

/**
 * No blank screens (SRS FR-G6). Say what belongs here and why it matters, then offer the one action that fills it:
 * <EmptyState icon={<Briefcase/>} title="No deals yet" action={<Button>Add your first prospect</Button>}>Every lead you add…</EmptyState>
 */
export function EmptyState({ icon, title, children, action, secondary, compact, className }: {
  icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; secondary?: ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      {icon && (
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary-text ring-8 ring-primary-soft/40 [&>svg]:size-6">{icon}</div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted-foreground">{children}</div>}
      {(action || secondary) && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}{secondary}</div>}
    </div>
  );
}

/** Something failed to load: say so in plain words and offer a retry. */
export function ErrorState({ title = "This didn't load", error, onRetry, className }: {
  title?: ReactNode; error?: unknown; onRetry?: () => void; className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-danger-soft text-danger-text [&>svg]:size-6"><CloudOff /></div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {error != null && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{errorText(error)}</p>}
      {onRetry && <Button variant="secondary" className="mt-5" onClick={onRetry}><RefreshCw /> Try again</Button>}
    </div>
  );
}
