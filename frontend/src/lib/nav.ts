import {
  Activity, BarChart3, Briefcase, CalendarCheck2, ClipboardList, LayoutDashboard, ListTodo, Network, Palette, Settings, ShieldCheck,
  Table2, UserRound, Users, type LucideIcon,
} from "lucide-react";
import type { Role } from "../api/types";

/** Every menu in the app comes from here: the sidebar, the phone tab bar, the command palette and the "New" menu.
    v3 adds the member menu from SRS FR-G8 (Home · My Day · My Pipeline · My Progress · Learn) as those screens land. */

export type BadgeKey = "pendingUsers";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  badge?: BadgeKey;
  keywords?: string;
}

export interface NavSection {
  id: string;
  title: string;
  roles?: Role[];
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    id: "team", title: "Team", items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Team hours, points and results at a glance", keywords: "home overview" },
      { to: "/sheets", label: "Sheets", icon: Table2, description: "The hour-by-hour work log", keywords: "log hours timesheet today fill" },
      { to: "/kpi", label: "Weekly KPI", icon: CalendarCheck2, description: "Leads, opportunities, clients and revenue per week", keywords: "results" },
      { to: "/performance", label: "Performance", icon: BarChart3, description: "Monthly, quarterly and yearly scores", keywords: "score composite" },
      { to: "/team", label: "People", icon: Users, description: "Who's on the team", keywords: "directory members" },
    ],
  },
  {
    id: "mine", title: "My work", items: [
      { to: "/tracker", label: "My pipeline", icon: Briefcase, description: "Your own pipeline, plan and activity", keywords: "tracker prospects deals follow-ups" },
    ],
  },
  {
    id: "admin", title: "Admin", roles: ["admin"], items: [
      { to: "/admin/approvals", label: "Approvals", icon: ShieldCheck, badge: "pendingUsers", description: "Approve new people and change access", keywords: "users sign-up" },
      { to: "/admin/settings", label: "Team setup", icon: Settings, description: "Sheets, targets, tasks, job roles and rules", keywords: "settings config" },
      { to: "/admin/pipelines", label: "Team pipelines", icon: Network, description: "Pipelines people have shared with admins" },
      { to: "/admin/activity", label: "Activity log", icon: ClipboardList, description: "Every change, who made it and when", keywords: "audit history" },
      { to: "/ui", label: "UI kit", icon: Palette, description: "Every component in both themes", keywords: "design system components" },
    ],
  },
];

/** Pages reached from the user menu rather than the sidebar. */
export const EXTRA: NavItem[] = [
  { to: "/profile", label: "My profile", icon: UserRound, description: "Your photo, position and contact details" },
];

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  roles?: Role[];
}

/** The global "New" menu (SRS FR-Q2). Each opens the exact screen for the job. */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "log", label: "Fill in today's hours", description: "Your sheet for today", to: "/sheets", icon: Table2, roles: ["admin", "member"] },
  { id: "plan", label: "Today's plan", description: "Tick off your daily plan", to: "/tracker?tab=plan", icon: ListTodo },
  { id: "activity", label: "Log an activity", description: "Calls, emails, meetings…", to: "/tracker?tab=activity", icon: Activity },
  { id: "deal", label: "Update my pipeline", description: "Add a prospect or move a deal", to: "/tracker?tab=pipeline", icon: Briefcase },
  { id: "kpi", label: "Enter weekly KPI", description: "This week's leads, opportunities and revenue", to: "/kpi", icon: CalendarCheck2, roles: ["admin", "member"] },
];

export const navFor = (role: Role) => NAV.filter((s) => !s.roles || s.roles.includes(role));
export const actionsFor = (role: Role) => QUICK_ACTIONS.filter((a) => !a.roles || a.roles.includes(role));

/** Which section and page a path belongs to, for the breadcrumb. */
export function routeInfo(pathname: string): { section: NavSection | null; item: NavItem } | null {
  for (const section of NAV) {
    for (const item of section.items) {
      if (pathname === item.to || pathname.startsWith(item.to + "/")) return { section, item };
    }
  }
  const extra = EXTRA.find((i) => pathname === i.to);
  return extra ? { section: null, item: extra } : null;
}
