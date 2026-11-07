import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import logoUrl from "../assets/dsl-logo.png";
import markUrl from "../assets/dsl-mark.png";

/* The DSL logo has a dark-blue "S" and black lettering, so on dark backgrounds it sits on a white tile. */
const tile = "dark:rounded-lg dark:bg-white dark:px-1.5 dark:py-1 dark:shadow-sm";

/** Full Daffodil Software Ltd. logo (letters, swoosh and company name). Height is set by className. */
export function Logo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="Daffodil Software Ltd." className={clsx("h-10 w-auto shrink-0 select-none", tile, className)} draggable={false} />;
}

/** Just the DSL letters, for tight spaces. */
export function LogoMark({ className }: { className?: string }) {
  return <img src={markUrl} alt="DSL" className={clsx("h-7 w-auto shrink-0 select-none", tile, className)} draggable={false} />;
}

/** Product name next to the logo. `compact` (sidebar) is the short lockup: "TOS" over "Team Operation System". */
export function BrandName({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="min-w-0 border-l border-border pl-2.5 leading-none">
        <div className="font-display text-[17px] font-extrabold tracking-tight text-accent-600 dark:text-accent-400">TOS</div>
        <div className="mt-1 truncate text-[11px] font-medium text-muted-foreground">Team Operation System</div>
      </div>
    );
  }
  return (
    <div className="min-w-0 border-l border-border pl-3 leading-tight">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Business Team</div>
      <div className="font-display text-base font-extrabold text-foreground">Operation System <span className="text-accent-600 dark:text-accent-400">TOS</span></div>
    </div>
  );
}

export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "xs" | "sm" | "md" | "lg" | "xl" }) {
  const s = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-24 text-2xl" }[size];
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return src
    ? <img src={src} alt="" referrerPolicy="no-referrer" className={clsx(s, "shrink-0 rounded-full object-cover ring-2 ring-card")} />
    : <span aria-hidden className={clsx(s, "inline-grid shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground ring-2 ring-card")}>{initials}</span>;
}

/** Overlapping avatars with a "+3" for the rest. */
export function AvatarGroup({ people, max = 4 }: { people: { name: string; src?: string | null }[]; max?: number }) {
  const shown = people.slice(0, max), rest = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => <Avatar key={p.name} name={p.name} src={p.src} size="sm" />)}
      {rest > 0 && <span className="inline-grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-card">+{rest}</span>}
    </div>
  );
}

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  return (
    <button type="button" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
