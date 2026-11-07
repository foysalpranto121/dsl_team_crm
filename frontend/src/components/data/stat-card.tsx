import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Progress, type MeterTone } from "../ui/progress";

export interface StatDelta {
  /** Signed change, used for the arrow and the colour. */
  value: number;
  /** How it reads: "+12%", "−3 h". */
  text: string;
  /** Compared with what: "vs last week". */
  label: string;
  /** False for numbers where down is good (e.g. overdue follow-ups). */
  upIsGood?: boolean;
}

/** The change since last period: arrow + signed text + what it's compared with, so it never relies on colour alone. */
export function Delta({ value, text, label, upIsGood = true }: StatDelta) {
  const good = value === 0 ? null : (value > 0) === upIsGood;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center gap-0.5 font-semibold", good == null ? "text-muted-foreground" : good ? "text-success-text" : "text-danger-text")}>
        <Icon className="size-3.5" aria-hidden />{text}
      </span>
      <span>{label}</span>
    </span>
  );
}

/** A small trend line: past periods in a quiet grey, the current one marked with a blue dot. */
export function Sparkline({ data, label, className }: { data: number[]; label: string; className?: string }) {
  if (data.length < 2) return null;
  const w = 100, h = 32, min = Math.min(...data), span = Math.max(...data) - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div className={cn("relative h-8 w-full", className)} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <path d={d} fill="none" className="stroke-subtle-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-card" style={{ left: `${lx}%`, top: `${(ly / h) * 100}%` }} aria-hidden />
    </div>
  );
}

/**
 * One headline number: label, value, optional target, progress meter, change since last period and a trend.
 * Values use proportional figures (not tabular) because they stand alone.
 */
export function StatCard({ label, value, unit, target, icon, progress, delta, trend, trendLabel, footer, to, className }: {
  label: string; value: ReactNode; unit?: ReactNode; target?: ReactNode; icon?: ReactNode;
  progress?: { value: number; max: number; tone?: MeterTone }; delta?: StatDelta; trend?: number[]; trendLabel?: string;
  footer?: ReactNode; to?: string; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4" aria-hidden>{icon}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{value}</span>
        {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
        {target != null && <span className="text-sm text-muted-foreground">of {target}</span>}
      </div>
      {trend && <Sparkline data={trend} label={trendLabel ?? `${label} trend`} className="mt-3" />}
      {progress && <Progress value={progress.value} max={progress.max} tone={progress.tone} size="sm" label={`${label}: progress to target`} className="mt-4" />}
      {(delta || footer) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {delta && <Delta {...delta} />}
          {delta && footer && <span aria-hidden>·</span>}
          {footer}
        </div>
      )}
    </>
  );
  const cls = cn("card flex flex-col p-5", to && "transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring", className);
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
