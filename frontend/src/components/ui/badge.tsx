import { AlertCircle, AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const toneClass = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  info: "bg-info-soft text-info-text",
  outline: "border border-border text-muted-foreground",
};
export type Tone = keyof typeof toneClass;

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5", toneClass[tone], className)}>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export type Status = "good" | "warning" | "danger" | "info" | "neutral";
const statusMap: Record<Status, { tone: Tone; Icon: typeof Info }> = {
  good: { tone: "success", Icon: CheckCircle2 },
  warning: { tone: "warning", Icon: AlertTriangle },
  danger: { tone: "danger", Icon: AlertCircle },
  info: { tone: "info", Icon: Info },
  neutral: { tone: "neutral", Icon: MinusCircle },
};

/** A status always carries an icon and a word, never colour alone (On target, Near, Behind…). */
export function StatusPill({ status, children, className }: { status: Status; children: ReactNode; className?: string }) {
  const { tone, Icon } = statusMap[status];
  return <Badge tone={tone} className={className}><Icon aria-hidden />{children}</Badge>;
}
