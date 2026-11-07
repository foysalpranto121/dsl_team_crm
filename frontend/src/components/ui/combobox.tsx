import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ComboOption {
  value: string;
  label: string;
  /** Shown on the right, e.g. "5 pts". */
  hint?: string;
  /** Options with the same group are listed under one heading. */
  group?: string;
  keywords?: string[];
  icon?: ReactNode;
}

/** A dropdown you can type into: for long lists such as activities, people or clients. */
export function Combobox({ options, value, onChange, placeholder = "Choose…", searchPlaceholder = "Search…", emptyText = "No matches.",
  clearable, disabled, size = "md", className, "aria-label": ariaLabel }: {
  options: ComboOption[]; value: string | null; onChange: (value: string | null) => void; placeholder?: string; searchPlaceholder?: string;
  emptyText?: string; clearable?: boolean; disabled?: boolean; size?: "sm" | "md"; className?: string; "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const m = new Map<string, ComboOption[]>();
    options.forEach((o) => m.set(o.group ?? "", [...(m.get(o.group ?? "") ?? []), o]));
    return [...m];
  }, [options]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled}
          className={cn("input flex items-center justify-between gap-2 text-left", size === "sm" && "py-1 text-[13px]", !selected && "text-subtle-foreground", className)}>
          <span className="flex min-w-0 items-center gap-2 truncate">{selected?.icon}{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map(([group, opts]) => (
              <CommandGroup key={group || "_"} heading={group || undefined}>
                {opts.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} keywords={o.keywords}
                    onSelect={() => { onChange(clearable && o.value === value ? null : o.value); setOpen(false); }}>
                    <Check className={cn("text-primary-text", o.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
                    {o.icon}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
