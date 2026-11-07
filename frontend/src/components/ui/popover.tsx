import { Popover as P } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { menuPanel } from "./dropdown-menu";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "center", sideOffset = 6, ...p }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content data-slot="popover" align={align} sideOffset={sideOffset}
        className={cn(menuPanel, "w-72 origin-(--radix-popover-content-transform-origin) p-4 outline-hidden", className)} {...p} />
    </P.Portal>
  );
}
