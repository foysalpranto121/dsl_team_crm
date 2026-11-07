import { Tooltip as T } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Mounted once in main.tsx. */
export const TooltipProvider = T.Provider;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...p }: ComponentProps<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content data-slot="tooltip" sideOffset={sideOffset}
        className={cn("z-50 max-w-64 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95", className)} {...p} />
    </T.Portal>
  );
}

/** A short label on hover and keyboard focus: <Tip content="Collapse sidebar"><button …/></Tip>. The child must accept a ref. */
export function Tip({ content, side, children, disabled }: { content: ReactNode; side?: "top" | "right" | "bottom" | "left"; children: ReactNode; disabled?: boolean }) {
  if (disabled || !content) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
