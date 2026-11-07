import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Bell, CalendarClock, CalendarSync, CheckCircle2, ShieldCheck, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { pendingUsersQuery, renewalsDueQuery, todayQuery, trackerSummaryQuery } from "@/api/queries";
import { useAuth } from "@/auth/AuthContext";
import { duration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, toneClass, type Tone } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../ui/popover";

interface Item { id: string; tone: Tone; icon: LucideIcon; title: string; body: string; to: string }

/**
 * "Needs your attention", worked out live from data the app already has: today's sheet not filled in,
 * people waiting for approval (admins), follow-ups due. Stored notifications (SRS FR-N1) replace this in M4.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const today = useQuery(todayQuery);
  const pending = useQuery({ ...pendingUsersQuery, enabled: isAdmin });
  const follow = useQuery({ ...trackerSummaryQuery, staleTime: 5 * 60_000 });
  const renewals = useQuery({ ...renewalsDueQuery, staleTime: 5 * 60_000, enabled: user?.role !== "viewer" });

  const items: Item[] = [];
  const t = today.data;
  if (t?.lock_days && t.my_sheets.some((s) => s.kind === "work" && !s.filled_today)) {
    items.push({ id: "unfilled", tone: "warning", icon: AlarmClock, title: "You haven't filled in today", body: `Today locks at midnight, in ${duration(t.seconds_to_lock)}.`, to: "/log" });
  }
  const waiting = isAdmin ? pending.data?.length ?? 0 : 0;
  if (waiting) {
    items.push({ id: "pending", tone: "primary", icon: ShieldCheck, title: `${waiting} ${waiting === 1 ? "person is" : "people are"} waiting for approval`, body: "Approve them so they can sign in.", to: "/admin/approvals" });
  }
  const due = follow.data?.due ?? [], dueCount = follow.data?.due_count ?? 0, overdue = due.filter((d) => d.overdue).length;
  if (dueCount) {
    const names = due.slice(0, 3).map((d) => d.company).join(", ");
    items.push({ id: "follow", tone: overdue ? "danger" : "primary", icon: CalendarClock, title: `${dueCount} follow-up${dueCount === 1 ? "" : "s"} due`,
      body: overdue ? `${overdue} overdue · ${names}` : names, to: "/tracker" });
  }
  const r = renewals.data;
  if (r?.count) {
    const late = r.items.filter((x) => x.overdue).length, first = r.items[0];
    items.push({ id: "renewals", tone: late || (first && first.days_left < 0) ? "danger" : "primary", icon: CalendarSync,
      title: `${r.count} ${r.count === 1 ? "renewal needs" : "renewals need"} a next step`,
      body: r.items.slice(0, 3).map((x) => x.client).join(", "), to: r.count === 1 && first ? `/renewals?tab=renew&open=${first.id}` : "/renewals?tab=renew" });
  }
  if (r?.unowned) {
    items.push({ id: "renewals-unowned", tone: "warning", icon: CalendarSync, title: `${r.unowned} ${r.unowned === 1 ? "renewal has" : "renewals have"} no owner`,
      body: "Nobody is reminded until a contract has an account owner.", to: "/renewals?tab=contracts" });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={items.length ? `Notifications: ${items.length} need your attention` : "Notifications"}>
          <Bell />
          {items.length > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background" aria-hidden>
              {items.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Needs your attention</h2>
          {items.length > 0 && <Badge>{items.length}</Badge>}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <CheckCircle2 className="mb-1 size-7 text-success" aria-hidden />
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted-foreground">Nothing needs you right now.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto p-1">
            {items.map((i) => (
              <li key={i.id}>
                <PopoverClose asChild>
                  <Link to={i.to} className="flex gap-3 rounded-md px-3 py-2.5 outline-hidden transition-colors hover:bg-muted focus-visible:bg-muted">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", toneClass[i.tone])}><i.icon className="size-4" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{i.body}</span>
                    </span>
                  </Link>
                </PopoverClose>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">Worked out live from your sheets, pipeline and renewals.</div>
      </PopoverContent>
    </Popover>
  );
}
