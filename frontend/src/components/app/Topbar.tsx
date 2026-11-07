import { ChevronRight, CircleHelp, Menu, Search } from "lucide-react";
import { useLocation } from "react-router";
import { routeInfo } from "@/lib/nav";
import { modKey } from "@/lib/utils";
import { LogoMark } from "../Brand";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tip } from "../ui/tooltip";
import { NotificationBell } from "./NotificationBell";
import { QuickAdd } from "./QuickAdd";
import { useShell } from "./shell";

/** Top bar: where you are, search (Ctrl K), New, notifications and help. */
export function Topbar() {
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const shell = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="-ml-1 lg:hidden" onClick={shell.openMobileNav} aria-label="Open menu"><Menu className="size-5" /></Button>
      <LogoMark className="lg:hidden" />
      {info && (
        <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
          <ol className="flex items-center gap-1.5 text-sm">
            {info.section && <li className="text-muted-foreground">{info.section.title}</li>}
            {info.section && <li aria-hidden><ChevronRight className="size-3.5 text-subtle-foreground" /></li>}
            <li aria-current="page" className="truncate font-medium text-foreground">{info.item.label}</li>
          </ol>
        </nav>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={shell.openCommand}
          className="mr-1 hidden h-9 w-64 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-subtle-foreground shadow-xs outline-hidden transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring md:flex xl:w-80">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">Search or jump to…</span>
          <span className="flex gap-0.5"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
        </button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={shell.openCommand} aria-label="Search"><Search /></Button>
        <QuickAdd className="mr-1 hidden lg:inline-flex" />
        <NotificationBell />
        <Tip content="Keyboard shortcuts">
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={shell.openShortcuts} aria-label="Keyboard shortcuts and help"><CircleHelp /></Button>
        </Tip>
      </div>
    </header>
  );
}
