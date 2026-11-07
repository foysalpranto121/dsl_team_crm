import { Tabs as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

/** `line` = underlined page tabs; `pill` = a segmented control for switching a view (week / month / year). */
export function TabsList({ className, variant = "line", ...p }: ComponentProps<typeof T.List> & { variant?: "line" | "pill" }) {
  return (
    <T.List data-variant={variant}
      className={cn("group/tabs flex items-center",
        variant === "line" ? "gap-1 overflow-x-auto border-b border-border" : "inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5", className)} {...p} />
  );
}

export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn("inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium text-muted-foreground outline-hidden transition-colors",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        // line
        "group-data-[variant=line]/tabs:-mb-px group-data-[variant=line]/tabs:border-b-2 group-data-[variant=line]/tabs:border-transparent",
        "group-data-[variant=line]/tabs:px-3 group-data-[variant=line]/tabs:py-2.5",
        "group-data-[variant=line]/tabs:data-[state=active]:border-primary group-data-[variant=line]/tabs:data-[state=active]:text-foreground",
        // pill
        "group-data-[variant=pill]/tabs:h-7 group-data-[variant=pill]/tabs:rounded-md group-data-[variant=pill]/tabs:px-3 group-data-[variant=pill]/tabs:text-[13px]",
        "group-data-[variant=pill]/tabs:data-[state=active]:bg-card group-data-[variant=pill]/tabs:data-[state=active]:text-foreground group-data-[variant=pill]/tabs:data-[state=active]:shadow-xs",
        className)} {...p} />
  );
}

export function TabsContent({ className, ...p }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("outline-hidden", className)} {...p} />;
}
