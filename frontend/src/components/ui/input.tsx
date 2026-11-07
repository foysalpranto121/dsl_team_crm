import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Text fields share the `.input` class from index.css, so native and custom controls line up at 36 px. */

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn("input", className)} {...p} />;
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn("input min-h-24 py-2 leading-relaxed", className)} {...p} />;
}

/** The browser's own <select>, styled to match. For short fixed lists in dense tables; use <Select> or <Combobox> elsewhere. */
export function NativeSelect({ className, ...p }: ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn("input", className)} {...p} />;
}

export function SearchInput({ className, ...p }: ComponentProps<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <input type="search" className="input pl-9" {...p} />
    </div>
  );
}

/** A labelled form field: label on top, the control, then a hint or an error. */
export function Field({ label, hint, error, children, className, required }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; required?: boolean;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}{required && <span className="ml-0.5 text-danger-text" aria-hidden>*</span>}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-danger-text" role="alert">{error}</span>
        : hint ? <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
