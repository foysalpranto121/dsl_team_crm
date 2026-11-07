import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MeterTone = "primary" | "success" | "warning" | "danger";
const fill: Record<MeterTone, string> = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
// The unfilled track is a lighter step of the same colour, so the state reads across the whole bar.
const track: Record<MeterTone, string> = { primary: "bg-primary-soft", success: "bg-success-soft", warning: "bg-warning-soft", danger: "bg-danger-soft" };
const ringFill: Record<MeterTone, string> = { primary: "stroke-primary", success: "stroke-success", warning: "stroke-warning", danger: "stroke-danger" };
const ringTrack: Record<MeterTone, string> = { primary: "stroke-primary-soft", success: "stroke-success-soft", warning: "stroke-warning-soft", danger: "stroke-danger-soft" };

const clamp = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

/** The colour for progress against a target: met → green, otherwise blue (warning and danger are for real problems). */
export const toneForRatio = (ratio: number | null | undefined): MeterTone => (ratio != null && ratio >= 1 ? "success" : "primary");

export function Progress({ value, max = 100, tone = "primary", size = "md", label, className }: {
  value: number; max?: number; tone?: MeterTone; size?: "sm" | "md"; label: string; className?: string;
}) {
  const p = clamp(value, max);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}
      className={cn("w-full overflow-hidden rounded-full", track[tone], size === "sm" ? "h-1.5" : "h-2", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", fill[tone])} style={{ width: `${p}%` }} />
    </div>
  );
}

/** A progress ring for today / week / month (SRS FR-MO1). Put the number in the middle as children. */
export function ProgressRing({ value, max = 100, size = 72, stroke = 7, tone = "primary", label, children, className }: {
  value: number; max?: number; size?: number; stroke?: number; tone?: MeterTone; label: string; children?: ReactNode; className?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = clamp(value, max);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}
      className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={ringTrack[tone]} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className={cn(ringFill[tone], "transition-[stroke-dashoffset] duration-700 ease-out")}
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
