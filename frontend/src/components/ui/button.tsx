import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold outline-hidden " +
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 " +
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "border border-input bg-card text-foreground shadow-xs hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        soft: "bg-primary-soft text-primary-text hover:bg-primary-soft/70",
        danger: "bg-danger text-white shadow-xs hover:bg-danger-hover",
        "danger-ghost": "text-danger-text hover:bg-danger-soft",
        link: "h-auto rounded-sm px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
        /** Padding only, no fixed height — what the pages written before v3 expect. */
        auto: "px-4 py-2",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {
  /** Render the child element (e.g. a router <Link>) with button styles. */
  asChild?: boolean;
  /** Shows a spinner and blocks clicks while something is saving. */
  busy?: boolean;
};

export function Button({ className, variant, size, asChild, busy, disabled, children, ...props }: ButtonProps) {
  if (asChild) {
    return <Slot.Root data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot.Root>;
  }
  return (
    <button data-slot="button" className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || busy}
      aria-busy={busy || undefined} {...props}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
