import {
  Activity, BarChart3, Briefcase, CalendarCheck2, CalendarClock, CalendarSync, ClipboardList, House, LayoutDashboard, LayoutGrid, ListTodo, Network, Newspaper,
  ListChecks, Settings, ShieldCheck, Sunrise, TrendingUp, Tv, UserRound, Users, Workflow, type LucideIcon,
} from "lucide-react";
import type { Feature, Role } from "../api/types";
import type { Features } from "./features";

/** Every menu in the app comes from here: the sidebar, the phone tab bar, the command palette and the "New" menu.
    SRS v0.5 FR-G5: the member menu grows to Home · My Day · My Tasks · My Pipeline · My Progress as those screens land;
    supervisor and admin items show only for those roles; V2 features only while switched on (§0). */

export type BadgeKey = "pendingUsers";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  badge?: BadgeKey;
  keywords?: string;
  roles?: Role[];
  feature?: Feature;
}

export interface NavSection {
  id: string;
  title: string;
  roles?: Role[];
  items: NavItem[];
}

const WORKERS: Role[] = ["admin", "supervisor", "member"];

export const NAV: NavSection[] = [
  {
    id: "mine", title: "My work", items: [
      { to: "/home", label: "Home", icon: House, description: "Your Daily Playbook: what to do today, in order", roles: WORKERS,
        keywords: "playbook today start my day close ring next" },
      { to: "/my-day", label: "My Day", icon: CalendarClock, description: "Plan your week, then log each hour against the plan", roles: WORKERS,
        keywords: "plan log hours timesheet today sheets daily log week approve" },
      { to: "/my-tasks", label: "My Tasks", icon: ListTodo, description: "Your to-do list, with dates and tasks your supervisor assigned", roles: WORKERS,
        keywords: "todo to-do reminders assigned due overdue checklist" },
      { to: "/tracker", label: "My pipeline", icon: Briefcase, description: "Your own pipeline and activity", keywords: "tracker prospects deals follow-ups" },
      { to: "/my-progress", label: "My Progress", icon: TrendingUp, description: "Your rings, gaps, coach and weekly recap", roles: ["supervisor", "member"],
        keywords: "rings gaps coach forecast recap weekly review analysis score" },
      { to: "/renewals", label: "Renewals", icon: CalendarSync, description: "AMCs, licences and software coming up for renewal", feature: "renewals",
        keywords: "amc contract licence subscription expiry renew upsell" },
    ],
  },
  {
    id: "team", title: "Team", items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Team hours, points and results at a glance", keywords: "home overview" },
      { to: "/team-board", label: "Team Board", icon: LayoutGrid, description: "Approve plans, deviations and unplanned hours", roles: ["admin", "supervisor"],
        keywords: "approve approvals plans board supervisor deviations" },
      { to: "/frameworks", label: "Frameworks", icon: Workflow, description: "Framework Studio: dated follow-up steps for each pipeline stage", roles: ["admin", "supervisor"],
        keywords: "framework studio steps follow-up cadence stage default overloaded template pack" },
      { to: "/team-review", label: "Team review", icon: ListChecks, description: "The week person by person: the 15-minute team review", roles: ["admin", "supervisor", "viewer"],
        keywords: "weekly review summary wins focus plans" },
      { to: "/huddle", label: "Morning huddle", icon: Sunrise, description: "Yesterday, today's plan, what needs attention, one focus", feature: "huddle",
        keywords: "meeting standup daily focus" },
      { to: "/kpi", label: "Weekly KPI", icon: CalendarCheck2, description: "Leads, opportunities, clients and revenue per week", keywords: "results" },
      { to: "/performance", label: "Performance", icon: BarChart3, description: "Monthly, quarterly and yearly scores", keywords: "score composite" },
      { to: "/team", label: "People", icon: Users, description: "Who's on the team", keywords: "directory members" },
    ],
  },
  {
    id: "admin", title: "Admin", roles: ["admin"], items: [
      { to: "/admin/approvals", label: "Approvals", icon: ShieldCheck, badge: "pendingUsers", description: "Approve new people and change access", keywords: "users sign-up" },
      { to: "/admin/settings", label: "Team setup", icon: Settings, description: "Daily logs, targets, tasks, roles, approval policy and features", keywords: "settings config features policy" },
      { to: "/admin/pipelines", label: "Team pipelines", icon: Network, description: "Pipelines people have shared with admins" },
      { to: "/admin/tv", label: "TV screens", icon: Tv, description: "Team progress and wins on the office TV", feature: "tv", keywords: "display office screen tv mode wins" },
      { to: "/admin/digest", label: "Weekly digest", icon: Newspaper, description: "The weekly email for admins and management", feature: "digest",
        keywords: "email report management summary" },
      { to: "/admin/activity", label: "Activity log", icon: ClipboardList, description: "Every change, who made it and when", keywords: "audit history" },
    ],
  },
];

/** Pages reached from the user menu rather than the sidebar. */
export const EXTRA: NavItem[] = [
  { to: "/weekly-review", label: "Weekly Review", icon: CalendarCheck2, description: "Confirm the week, pick one focus, send next week's plan" },
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
  { id: "log", label: "Log today's hours", description: "Confirm your planned hours, log the rest", to: "/my-day", icon: CalendarClock, roles: WORKERS },
  { id: "plan", label: "Plan my week", description: "Plan the hours and send them for approval", to: "/my-day?tab=plan", icon: LayoutGrid, roles: WORKERS },
  { id: "task", label: "Add a task", description: "Put something on your to-do list", to: "/my-tasks?new=1", icon: ListTodo, roles: WORKERS },
  { id: "activity", label: "Log an activity", description: "Calls, emails, meetings…", to: "/tracker?tab=activity", icon: Activity },
  { id: "deal", label: "Update my pipeline", description: "Add a prospect or move a deal", to: "/tracker?tab=pipeline", icon: Briefcase },
  { id: "review", label: "Weekly Review", description: "Ten minutes to wrap up the week", to: "/weekly-review", icon: ListChecks, roles: WORKERS },
  { id: "kpi", label: "Enter weekly KPI", description: "This week's leads, opportunities and revenue", to: "/kpi", icon: CalendarCheck2, roles: WORKERS },
];

const allowed = (item: { roles?: Role[]; feature?: Feature }, role: Role, features?: Features) =>
  (!item.roles || item.roles.includes(role)) && (!item.feature || !!features?.[item.feature]);

/** Where someone lands: the Daily Playbook, or the Dashboard for management, who don't log work. */
export const homeFor = (role?: Role) => (role === "viewer" ? "/dashboard" : "/home");

export const navFor = (role: Role, features?: Features) =>
  NAV.filter((s) => !s.roles || s.roles.includes(role))
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed(i, role, features)) }))
    .filter((s) => s.items.length > 0);
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
