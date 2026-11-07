import { X } from "lucide-react";
import { AlertDialog as A, Dialog as D } from "radix-ui";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export const overlayClass = "fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

const panelClass = "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col " +
  "overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-hidden duration-200 " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function DialogContent({ className, children, size = "md", hideClose, ...p }:
  ComponentProps<typeof D.Content> & { size?: keyof typeof sizes; hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content data-slot="dialog" className={cn(panelClass, sizes[size], className)} {...p}>
        {children}
        {!hideClose && (
          <D.Close aria-label="Close" className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export const DialogHeader = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("flex flex-col gap-1 px-6 pb-3 pr-12 pt-5", className)} {...p} />;
export const DialogBody = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-5", className)} {...p} />;
export const DialogFooter = ({ className, ...p }: ComponentProps<"div">) =>
  <div className={cn("flex flex-col-reverse gap-2 border-t border-border bg-muted/40 px-6 py-3 sm:flex-row sm:justify-end", className)} {...p} />;
export const DialogTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base font-semibold text-foreground", className)} {...p} />;
export const DialogDescription = ({ className, ...p }: ComponentProps<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;

/**
 * "Are you sure?" before anything that can't be undone. `onConfirm` may return a promise: the button shows a spinner and
 * the dialog closes when it resolves (it stays open on an error, so the caller can show what went wrong).
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger", onConfirm, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: "danger" | "primary"; onConfirm: () => unknown | Promise<unknown>; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch { /* the caller reports the error; keep the dialog open */ } finally {
      setBusy(false);
    }
  };
  return (
    <A.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <A.Portal>
        <A.Overlay className={overlayClass} />
        <A.Content className={cn(panelClass, sizes.sm)}>
          <div className="px-6 pb-4 pt-5">
            <A.Title className="text-base font-semibold text-foreground">{title}</A.Title>
            {description && <A.Description className="mt-1.5 text-sm text-muted-foreground">{description}</A.Description>}
            {children}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/40 px-6 py-3 sm:flex-row sm:justify-end">
            <A.Cancel asChild><Button variant="secondary" disabled={busy}>{cancelLabel}</Button></A.Cancel>
            <Button variant={tone} busy={busy} onClick={confirm}>{confirmLabel}</Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
