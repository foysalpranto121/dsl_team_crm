import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A keyboard key: <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>. */
export function Kbd({ className, ...p }: ComponentProps<"kbd">) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 select-none items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground", className)} {...p} />
  );
}
