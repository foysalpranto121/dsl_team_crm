import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small set of mutually exclusive choices shown side by side (a filter or a view switch), with an optional count each. */
export function Segmented<K extends string>({ value, onChange, options, label, className }: {
  value: K; onChange: (k: K) => void; options: { key: K; label: ReactNode; count?: number; icon?: ReactNode }[]; label: string; className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-muted p-0.5", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
            value === o.key && "bg-card text-foreground shadow-xs")}>
          {o.icon}{o.label}{o.count != null && <span className="num text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
