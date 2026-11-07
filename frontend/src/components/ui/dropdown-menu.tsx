import { Check, Circle } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;
export const DropdownMenuRadioGroup = M.RadioGroup;

export const menuPanel = "z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 " +
  "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1";

const item = "relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-hidden " +
  "data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...p }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content data-slot="menu" sideOffset={sideOffset} align={align}
        className={cn(menuPanel, "origin-(--radix-dropdown-menu-content-transform-origin)", className)} {...p} />
    </M.Portal>
  );
}

export function DropdownMenuItem({ className, tone, ...p }: ComponentProps<typeof M.Item> & { tone?: "danger" }) {
  return <M.Item className={cn(item, tone === "danger" && "text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:!text-danger-text", className)} {...p} />;
}

export function DropdownMenuCheckboxItem({ className, children, ...p }: ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(item, "pl-8", className)} {...p}>
      <span className="absolute left-2 flex size-4 items-center justify-center"><M.ItemIndicator><Check className="!text-primary-text" /></M.ItemIndicator></span>
      {children}
    </M.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...p }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, "pl-8", className)} {...p}>
      <span className="absolute left-2 flex size-4 items-center justify-center"><M.ItemIndicator><Circle className="size-2 fill-current !text-primary-text" /></M.ItemIndicator></span>
      {children}
    </M.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...p }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...p} />;
}

export function DropdownMenuSeparator({ className, ...p }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
}

export function DropdownMenuShortcut({ className, ...p }: ComponentProps<"span">) {
  return <span className={cn("ml-auto pl-4 text-xs tracking-wide text-subtle-foreground", className)} {...p} />;
}
