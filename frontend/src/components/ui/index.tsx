import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge as NewBadge, type Tone } from "./badge";
import { Button as NewButton, type ButtonProps } from "./button";

/* The original component names and props, now drawn with the v3 design system. Every page written before v3
   imports from here, so they all get the new look without changes; M2 moves each page onto the new parts directly. */

export { Field, Input, NativeSelect as Select, Textarea } from "./input";
export { EmptyState } from "../data/states";

/** Pages before v3 size buttons with padding, so the default here is size "auto". */
export function Button(p: ButtonProps) {
  return <NewButton {...p} size={p.size ?? "auto"} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card", className)}>{children}</div>;
}

const legacyTone: Record<string, Tone> = { slate: "neutral", green: "success", amber: "warning", red: "danger", brand: "primary", accent: "primary" };
export function Badge({ tone = "slate", children, className }: { tone?: "slate" | "green" | "amber" | "red" | "brand" | "accent"; children: ReactNode; className?: string }) {
  return <NewBadge tone={legacyTone[tone]} className={className}>{children}</NewBadge>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>   {/* v0.5 §10.2: page title 24/32 */}
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const alertTone = {
  red: { cls: "border-danger/25 bg-danger-soft text-danger-text", Icon: AlertCircle },
  amber: { cls: "border-warning/30 bg-warning-soft text-warning-text", Icon: AlertTriangle },
  green: { cls: "border-success/25 bg-success-soft text-success-text", Icon: CheckCircle2 },
  blue: { cls: "border-info/25 bg-info-soft text-info-text", Icon: Info },
};
export function Alert({ tone = "red", children, className }: { tone?: keyof typeof alertTone; children: ReactNode; className?: string }) {
  const { cls, Icon } = alertTone[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 [&_a]:font-semibold">{children}</div>
    </div>
  );
}
