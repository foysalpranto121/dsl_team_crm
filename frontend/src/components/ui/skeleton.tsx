import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A grey placeholder in the shape of what's loading, so the page doesn't jump when data arrives. */
export function Skeleton({ className, ...p }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...p} />;
}

/** Loading state for a typical page: header, a row of stat cards, two charts and a table. */
export function PageSkeleton({ stats = 4, charts = 2, rows = 6 }: { stats?: number; charts?: number; rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      {stats > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="card p-5"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-7 w-28" /><Skeleton className="mt-4 h-1.5 w-full" /></div>
          ))}
        </div>
      )}
      {charts > 0 && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          {Array.from({ length: charts }, (_, i) => <div key={i} className="card p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-6 h-56 w-full" /></div>)}
        </div>
      )}
      {rows > 0 && <div className="card mt-6 p-5"><TableSkeleton rows={rows} /></div>}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/4" : "flex-1")} />)}
        </div>
      ))}
    </div>
  );
}
