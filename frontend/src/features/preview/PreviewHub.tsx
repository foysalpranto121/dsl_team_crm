import { ArrowRight, BarChart3, BellRing, FileBarChart, Settings2, UserRoundPlus, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { SampleBanner } from "./parts";

const AREAS: { to: string; name: string; srs: string; icon: LucideIcon; what: string; check: string[] }[] = [
  { to: "/preview/onboarding", name: "Onboarding", srs: "§5.10", icon: UserRoundPlus, what: "A new person's first 10 minutes, what their supervisor sees, help and tours, and the first 30 days.",
    check: ["Do the five steps read plainly?", "Is the practice hour clearly not scored?", "Does stopping and coming back work?"] },
  { to: "/preview/role-dashboards", name: "Role dashboards", srs: "§5.13, FR-S5, FR-S6", icon: BarChart3, what: "One dashboard each for a member, a supervisor and management, with filters, saved views and leaderboard modes.",
    check: ["Does each role see what it needs first?", "Does a number open the entries behind it?", "Is the ranking encouraging, with no bottom list?"] },
  { to: "/preview/reports", name: "Reports", srs: "§5.14", icon: FileBarChart, what: "The five prebuilt reports, each with a chart, a table, a suggested action and export.",
    check: ["Are these the right columns?", "Is each suggested action useful?", "Do the totals look right?"] },
  { to: "/preview/notifications", name: "Notifications and the phone app", srs: "§5.15", icon: BellRing, what: "The inbox, each person's own settings, logging an hour on a phone in 3 taps, and working offline.",
    check: ["Do quiet hours and the daily cap behave as you'd expect?", "Is logging fast enough?", "Is it clear what's waiting to sync?"] },
  { to: "/preview/configuration", name: "The remaining configuration gaps and leave handling", srs: "§5.1, §6, §7", icon: Settings2, what: "Slot length, status thresholds, approver and SLA, individual overrides, activity CSV, template packs, and leave.",
    check: ["Would an admin find each setting?", "Is the effect of leave on targets clear?", "Is the CSV's problem report easy to act on?"] },
];

/** Screens on sample data, to judge the output and the look before they're connected to real data (user's request; SRS §11 Phase 0). Only in `npm run dev`. */
export default function PreviewHub() {
  return (
    <>
      <PageHeader title="Preview" subtitle="Five new areas on sample data. Check the output and the look; once you're happy, they get connected to your real data." />
      <SampleBanner />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {AREAS.map((a) => (
          <li key={a.to}>
            <Link to={a.to} className="card group flex h-full flex-col p-5 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text"><a.icon className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">{a.name}</h2><Badge tone="outline" className="mt-1">SRS {a.srs}</Badge></div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
              <p className="mt-3 text-sm">{a.what}</p>
              <p className="mt-3 text-xs font-semibold text-muted-foreground">What to check</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{a.check.map((c) => <li key={c}>{c}</li>)}</ul>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
