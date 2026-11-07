import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as S } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Accessible dropdown (Radix). Note: an item's value can't be "" — use a sentinel such as "none" for "no choice". */
export const Select = S.Root;
export const SelectGroup = S.Group;
export const SelectValue = S.Value;

export function SelectTrigger({ className, children, size = "md", ...p }: ComponentProps<typeof S.Trigger> & { size?: "sm" | "md" }) {
  return (
    <S.Trigger data-slot="select-trigger"
      className={cn("input flex items-center justify-between gap-2 text-left data-[placeholder]:text-subtle-foreground [&>span]:truncate",
        size === "sm" && "py-1 text-[13px]", className)} {...p}>
      {children}
      <S.Icon asChild><ChevronDown className="size-4 shrink-0 text-subtle-foreground" aria-hidden /></S.Icon>
    </S.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", ...p }: ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content data-slot="select-content" position={position} sideOffset={4}
        className={cn("relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden",
          "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95", className)} {...p}>
        <S.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground"><ChevronUp className="size-4" /></S.ScrollUpButton>
        <S.Viewport className="p-1">{children}</S.Viewport>
        <S.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground"><ChevronDown className="size-4" /></S.ScrollDownButton>
      </S.Content>
    </S.Portal>
  );
}

export function SelectItem({ className, children, ...p }: ComponentProps<typeof S.Item>) {
  return (
    <S.Item data-slot="select-item"
      className={cn("relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm outline-hidden",
        "data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...p}>
      <S.ItemText>{children}</S.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <S.ItemIndicator><Check className="size-4 text-primary-text" /></S.ItemIndicator>
      </span>
    </S.Item>
  );
}

export function SelectLabel({ className, ...p }: ComponentProps<typeof S.Label>) {
  return <S.Label className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...p} />;
}

export function SelectSeparator({ className, ...p }: ComponentProps<typeof S.Separator>) {
  return <S.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
}

/** The common case in one line: <SimpleSelect value onValueChange options={[{value, label}]} />. */
export function SimpleSelect({ options, placeholder, className, size, "aria-label": ariaLabel, ...p }:
  ComponentProps<typeof S.Root> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string;
    className?: string; size?: "sm" | "md"; "aria-label"?: string }) {
  return (
    <Select {...p}>
      <SelectTrigger className={className} size={size} aria-label={ariaLabel}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
