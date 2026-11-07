import { Command as C } from "cmdk";
import { Search } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { overlayClass } from "./dialog";

/** Searchable list (cmdk): the command palette, comboboxes and pickers. */
export function Command({ className, ...p }: ComponentProps<typeof C>) {
  return <C className={cn("flex size-full flex-col overflow-hidden bg-popover text-popover-foreground", className)} {...p} />;
}

export function CommandInput({ className, ...p }: ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-3" cmdk-input-wrapper="">
      <Search className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
      <C.Input className={cn("h-11 w-full bg-transparent text-sm outline-hidden placeholder:text-subtle-foreground", className)} {...p} />
    </div>
  );
}

export function CommandList({ className, ...p }: ComponentProps<typeof C.List>) {
  return <C.List className={cn("max-h-[min(60dvh,400px)] scroll-py-1 overflow-y-auto overscroll-contain p-1", className)} {...p} />;
}

export function CommandEmpty(p: ComponentProps<typeof C.Empty>) {
  return <C.Empty className="py-10 text-center text-sm text-muted-foreground" {...p} />;
}

export function CommandGroup({ className, ...p }: ComponentProps<typeof C.Group>) {
  return <C.Group className={cn("overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground", className)} {...p} />;
}

export function CommandItem({ className, ...p }: ComponentProps<typeof C.Item>) {
  return (
    <C.Item className={cn("relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-hidden",
      "data-[selected=true]:bg-muted data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground", className)} {...p} />
  );
}

export function CommandSeparator({ className, ...p }: ComponentProps<typeof C.Separator>) {
  return <C.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
}

/** The palette in a dialog near the top of the screen. */
export function CommandDialog({ open, onOpenChange, title, children, footer }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content aria-describedby={undefined}
          className="fixed left-1/2 top-[12dvh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl outline-hidden duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <D.Title className="sr-only">{title}</D.Title>
          <Command loop>{children}</Command>
          {footer && <div className="flex items-center gap-4 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
