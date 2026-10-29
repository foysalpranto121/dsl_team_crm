import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BarChart3, Briefcase, CalendarCheck2, ClipboardList, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Table2, UserRound, Users, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { api } from "../api/client";
import type { AdminUser, Today } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Avatar, BrandName, Logo, LogoMark, ThemeToggle } from "./Brand";

type Item = { to: string; label: string; icon: ReactNode; badge?: number };

function NavGroup({ title, items, onNavigate }: { title: string; items: Item[]; onNavigate: () => void }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</div>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} onClick={onNavigate}
          className={({ isActive }) => clsx("group mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive ? "bg-brand-700 text-white shadow-sm dark:bg-white/10" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white")}>
          <span className="[&>svg]:size-[18px]">{i.icon}</span>
          <span className="flex-1">{i.label}</span>
          {!!i.badge && <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[11px] font-bold text-white">{i.badge}</span>}
        </NavLink>
      ))}
    </div>
  );
}

/** Keeps every page on the team's current day: checks the server's "today" every minute, and at midnight
    (team time zone) reloads all data so yesterday shows as locked and the new day — or new month — opens by itself. */
function useDayRollover() {
  const qc = useQueryClient();
  const today = useQuery({
    queryKey: ["today"],
    queryFn: async () => (await api.get<Today>("/team/today/")).data,
    refetchInterval: 60_000,
  });
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

export default function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  useDayRollover();
  const isAdmin = user?.role === "admin";
  const pending = useQuery({
    queryKey: ["admin-users", "pending"],
    queryFn: async () => (await api.get<AdminUser[]>("/admin/users/?status=pending")).data,
    enabled: isAdmin,
    refetchInterval: 60_000,
  });
  if (!user) return null;
  const close = () => setOpen(false);

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      <NavGroup title="Team" onNavigate={close} items={[
        { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
        { to: "/sheets", label: "Sheets", icon: <Table2 /> },
        { to: "/kpi", label: "Weekly KPI", icon: <CalendarCheck2 /> },
        { to: "/performance", label: "Performance", icon: <BarChart3 /> },
        { to: "/team", label: "People", icon: <Users /> },
      ]} />
      <NavGroup title="My tracker" onNavigate={close} items={[
        { to: "/tracker", label: "Pipeline & plan", icon: <Briefcase /> },
        { to: "/profile", label: "My profile", icon: <UserRound /> },
      ]} />
      {isAdmin && (
        <NavGroup title="Admin" onNavigate={close} items={[
          { to: "/admin/approvals", label: "Approvals", icon: <ShieldCheck />, badge: pending.data?.length },
          { to: "/admin/settings", label: "Team setup", icon: <Settings /> },
          { to: "/admin/pipelines", label: "Team pipelines", icon: <Briefcase /> },
          { to: "/admin/activity", label: "Activity log", icon: <ClipboardList /> },
        ]} />
      )}
    </nav>
  );

  const me = (
    <div className="flex items-center gap-3 border-t border-slate-200 p-3 dark:border-white/10">
      <Avatar name={user.name || user.email} src={user.profile.photo_url} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user.name || user.email}</div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400"><span className="capitalize">{user.role}</span> · {user.profile.position || "Team member"}</div>
      </div>
      <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white">
        <LogOut className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-slate-200 bg-white lg:flex dark:border-white/10 dark:bg-brand-900/60">
        <div className="flex items-center gap-3 px-5 py-5"><Logo /><BrandName /></div>
        {nav}
        {me}
      </aside>

      {/* phone top bar + drawer */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-white/10 dark:bg-brand-950/90">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><Menu className="size-5" /></button>
        <LogoMark /><BrandName compact />
        <div className="ml-auto"><ThemeToggle /></div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-brand-950/50" onClick={close} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-brand-900">
            <div className="flex items-center gap-3 px-5 py-4"><Logo /><BrandName />
              <button type="button" onClick={close} aria-label="Close menu" className="ml-auto rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X className="size-5" /></button>
            </div>
            {nav}
            {me}
          </div>
        </div>
      )}

      <main className="min-w-0">
        <div className="hidden justify-end px-8 pt-5 lg:flex"><ThemeToggle /></div>
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-2"><Outlet /></div>
      </main>
    </div>
  );
}
