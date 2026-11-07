import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold",
        nav: "absolute inset-x-0 top-0 z-10 flex items-center justify-between",
        button_previous: buttonVariants({ variant: "ghost", size: "icon-sm" }),
        button_next: buttonVariants({ variant: "ghost", size: "icon-sm" }),
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground",
        week: "mt-1 flex",
        day: "group/day relative size-9 p-0 text-center text-sm",
        day_button: "inline-flex size-9 items-center justify-center rounded-md outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring " +
          "group-data-[selected]/day:bg-primary group-data-[selected]/day:font-semibold group-data-[selected]/day:text-primary-foreground group-data-[selected]/day:hover:bg-primary-hover",
        today: "[&:not([data-selected])>button]:font-semibold [&:not([data-selected])>button]:text-primary-text [&:not([data-selected])>button]:ring-1 [&:not([data-selected])>button]:ring-primary/30",
        outside: "text-subtle-foreground opacity-60",
        disabled: "opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: c }) => (orientation === "left" ? <ChevronLeft className={cn("size-4", c)} /> : <ChevronRight className={cn("size-4", c)} />),
      }}
      {...props}
    />
  );
}

/** Pick one day. Works in ISO strings ("2026-11-07") like the API. The team week starts on Saturday by default. */
export function DatePicker({ value, onChange, placeholder = "Pick a date", weekStartsOn = 6, disabled, className, "aria-label": ariaLabel }: {
  value: string | null; onChange: (iso: string | null) => void; placeholder?: string; weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  disabled?: boolean; className?: string; "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const day = value ? parseISO(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel}
          className={cn("input flex items-center gap-2 text-left", !day && "text-subtle-foreground", className)}>
          <CalendarDays className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
          <span className="truncate">{day ? format(day, "EEE, d MMM yyyy") : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={day} defaultMonth={day} weekStartsOn={weekStartsOn}
          onSelect={(d) => { onChange(d ? format(d, "yyyy-MM-dd") : null); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
}
