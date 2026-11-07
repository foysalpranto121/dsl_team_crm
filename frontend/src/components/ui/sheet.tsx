import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { overlayClass } from "./dialog";

/** A panel that slides in from the edge: record details on the right, the phone menu on the left, quick actions from the bottom. */
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

const sides = {
  right: "inset-y-0 right-0 h-full w-full border-l sm:max-w-md data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 h-full w-72 max-w-[85vw] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
};

export function SheetContent({ className, children, side = "right", hideClose, ...p }:
  ComponentProps<typeof D.Content> & { side?: keyof typeof sides; hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content data-slot="sheet"
        className={cn("fixed z-50 flex flex-col border-border bg-popover text-popover-foreground shadow-xl outline-hidden duration-300 ease-out",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200", sides[side], className)} {...p}>
        {children}
        {!hideClose && (
          <D.Close aria-label="Close" className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export const SheetHeader = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("flex flex-col gap-1 border-b border-border px-5 py-4 pr-12", className)} {...p} />;
export const SheetBody = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...p} />;
export const SheetFooter = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("flex justify-end gap-2 border-t border-border px-5 py-3", className)} {...p} />;
export const SheetTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base font-semibold", className)} {...p} />;
export const SheetDescription = ({ className, ...p }: ComponentProps<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;
