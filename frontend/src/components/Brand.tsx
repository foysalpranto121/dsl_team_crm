import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
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

export function BrandName({ compact }: { compact?: boolean }) {
  return (
    <div className="min-w-0 border-l border-slate-200 pl-3 leading-tight dark:border-white/15">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-400">Business Team</div>
      <div className={clsx("font-display font-extrabold text-brand-800 dark:text-white", compact ? "text-sm" : "text-base")}>Operation System <span className="text-accent-600 dark:text-accent-400">TOS</span></div>
    </div>
  );
}

export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const s = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-24 text-2xl" }[size];
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return src
    ? <img src={src} alt="" referrerPolicy="no-referrer" className={clsx(s, "shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-brand-900")} />
    : <span aria-hidden className={clsx(s, "inline-grid shrink-0 place-items-center rounded-full bg-brand-700 font-semibold text-white ring-2 ring-white dark:bg-brand-400 dark:text-brand-950 dark:ring-brand-900")}>{initials}</span>;
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* private mode: theme just won't be remembered */ }
    setDark(next);
  };
  return (
    <button type="button" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
