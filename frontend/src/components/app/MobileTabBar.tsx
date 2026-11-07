import { Briefcase, LayoutDashboard, Menu, Table2, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";
import { QuickAdd } from "./QuickAdd";
import { useShell } from "./shell";

const tab = "flex flex-col items-center gap-1 rounded-lg py-1 text-[11px] font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(tab, isActive ? "text-primary-text" : "text-muted-foreground")}>
      <Icon className="size-5" aria-hidden />{label}
    </NavLink>
  );
}

/** Phone and tablet: the most used pages one tap away, with "New" in the middle (SRS FR-Q1/Q2: ≤ 3 taps). */
export function MobileTabBar() {
  const shell = useShell();
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
        <li><Tab to="/dashboard" label="Dashboard" icon={LayoutDashboard} /></li>
        <li><Tab to="/sheets" label="Sheets" icon={Table2} /></li>
        <li className="flex justify-center"><QuickAdd variant="fab" /></li>
        <li><Tab to="/tracker" label="Pipeline" icon={Briefcase} /></li>
        <li>
          <button type="button" onClick={shell.openMobileNav} className={cn(tab, "w-full text-muted-foreground")}>
            <Menu className="size-5" aria-hidden />Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}
