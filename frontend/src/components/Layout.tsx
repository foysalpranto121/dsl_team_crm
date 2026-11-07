import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { pendingUsersQuery, todayQuery } from "../api/queries";
import { useAuth } from "../auth/AuthContext";
import { useLocalState } from "../lib/use-local-state";
import { cn, isTyping } from "../lib/utils";
import { CommandMenu } from "./app/CommandMenu";
import { MobileTabBar } from "./app/MobileTabBar";
import { ShellContext, type Shell } from "./app/shell";
import { ShortcutsDialog } from "./app/ShortcutsDialog";
import { Sidebar } from "./app/Sidebar";
import { Topbar } from "./app/Topbar";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

/** Keeps every page on the team's current day: checks the server's "today" every minute, and at midnight
    (team time zone) reloads all data so yesterday shows as locked and the new day — or new month — opens by itself. */
function useDayRollover() {
  const qc = useQueryClient();
  const today = useQuery({ ...todayQuery, refetchInterval: 60_000 });
  const seconds = today.data?.seconds_to_lock;
  useEffect(() => {
    if (seconds == null) return;
    const t = window.setTimeout(() => qc.invalidateQueries(), (Math.min(seconds, 86_400) + 2) * 1000);
    return () => window.clearTimeout(t);
  }, [seconds, qc]);
  useEffect(() => {   // a laptop that slept through midnight catches up when it wakes
    const wake = () => { if (document.visibilityState === "visible") qc.invalidateQueries({ queryKey: ["today"] }); };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, [qc]);
  const day = today.data?.today;
  const seen = useRef(day);
  useEffect(() => {   // the date changed (midnight passed): reload everything else too
    if (day && seen.current && day !== seen.current) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "today" });
    seen.current = day;
  }, [day, qc]);
}

/** The signed-in app frame: sidebar (collapsible on desktop, a drawer on phones), top bar, phone tab bar, Ctrl K palette. */
export default function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useLocalState("sidebar-collapsed", false);
  const [mobileNav, setMobileNav] = useState(false);
  const [command, setCommand] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  useDayRollover();
  const pending = useQuery({ ...pendingUsersQuery, enabled: user?.role === "admin", refetchInterval: 60_000 });

  useEffect(() => setMobileNav(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTyping(e) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShortcuts(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shell = useMemo<Shell>(() => ({
    openCommand: () => setCommand(true),
    openShortcuts: () => setShortcuts(true),
    openMobileNav: () => setMobileNav(true),
  }), []);

  if (!user) return null;
  const badges = { pendingUsers: pending.data?.length };

  return (
    <ShellContext.Provider value={shell}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground">
        Skip to content
      </a>
      <div className={cn("min-h-dvh transition-[grid-template-columns] duration-200 lg:grid", collapsed ? "lg:grid-cols-[68px_1fr]" : "lg:grid-cols-[248px_1fr]")}>
        <aside className="sticky top-0 hidden h-dvh border-r border-border bg-sidebar lg:block">
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} badges={badges} />
        </aside>

        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="bg-sidebar p-0" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <Sidebar badges={badges} onNavigate={() => setMobileNav(false)} inDrawer />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-col">
          <Topbar />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-6 outline-hidden sm:px-6 lg:px-8 lg:pb-16 lg:pt-8">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileTabBar />
      <CommandMenu open={command} onOpenChange={setCommand} />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </ShellContext.Provider>
  );
}
