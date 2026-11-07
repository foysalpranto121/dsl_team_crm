import { Check, Minus } from "lucide-react";
import { Checkbox as C, RadioGroup as R, Switch as Sw } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const focus = "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Checkbox({ className, ...p }: ComponentProps<typeof C.Root>) {
  return (
    <C.Root data-slot="checkbox"
      className={cn("peer grid size-4 shrink-0 place-items-center rounded-[5px] border border-input bg-card shadow-xs transition-colors", focus,
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50", className)} {...p}>
      <C.Indicator className="group grid place-items-center">
        <Check className="size-3 group-data-[state=indeterminate]:hidden" strokeWidth={3.5} />
        <Minus className="hidden size-3 group-data-[state=indeterminate]:block" strokeWidth={3.5} />
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...p }: ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root data-slot="switch"
      className={cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors", focus,
        "data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50", className)} {...p}>
      <Sw.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </Sw.Root>
  );
}

export function RadioGroup({ className, ...p }: ComponentProps<typeof R.Root>) {
  return <R.Root data-slot="radio-group" className={cn("grid gap-2.5", className)} {...p} />;
}

export function RadioGroupItem({ className, ...p }: ComponentProps<typeof R.Item>) {
  return (
    <R.Item data-slot="radio" className={cn("grid size-4 shrink-0 place-items-center rounded-full border border-input bg-card shadow-xs", focus,
      "data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50", className)} {...p}>
      <R.Indicator className="size-2 rounded-full bg-primary" />
    </R.Item>
  );
}

/** A checkbox, switch or radio with its label and an optional one-line description. */
export function Choice({ control, label, description, className }: { control: ReactNode; label: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", className)}>
      <span className="mt-0.5 flex">{control}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
