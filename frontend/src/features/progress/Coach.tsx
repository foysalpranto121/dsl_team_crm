import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import { briefQuery, recordCoachQuery } from "./api";

/** The supervisor's morning brief (SRS v0.5 FR-AC6): "Your 3 actions today" and 3 to 5 lines per member, each linked to its source. */
export function MorningBrief() {
  const q = useQuery(briefQuery);
  const [open, setOpen] = useState<number | null>(null);
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="card overflow-hidden" aria-labelledby="brief-title">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 id="brief-title" className="text-sm font-semibold">Morning brief</h2><Badge tone="outline"><Sparkles aria-hidden />AI Coach</Badge>
      </div>
      {d.actions.length > 0 && <div className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold text-muted-foreground">Your {d.actions.length === 1 ? "action" : `${d.actions.length} actions`} today</h3>
        <ol className="mt-1.5 space-y-1.5">{d.actions.map((a) => (
          <li key={a.text}><Link to={a.to} className="group flex items-start gap-2 rounded-sm text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden /><span><span className="font-medium">{a.text}</span> <span className="text-xs text-muted-foreground">{a.why}</span></span></Link></li>))}</ol>
      </div>}
      <ul className="divide-y divide-border">{d.members.map((m) => (
        <li key={m.work}>
          <h3><button type="button" onClick={() => setOpen(open === m.work ? null : m.work)} aria-expanded={open === m.work}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring max-sm:h-11">
            {m.person}<ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open === m.work && "rotate-180")} aria-hidden /></button></h3>
          {open === m.work && <ul className="space-y-1 px-4 pb-3 text-sm">{m.lines.map((l) => <li key={l.text}><Link to={l.to} className="hover:underline">{l.text}</Link></li>)}</ul>}
        </li>))}</ul>
    </section>
  );
}

/** A record's next step (SRS v0.5 FR-AC4): next best action, last contact, days in stage, and similar past wins and losses. */
export function RecordCoach({ recordId }: { recordId: number }) {
  const q = useQuery(recordCoachQuery(recordId));
  if (!q.data) return null;
  const d = q.data;
  const over = d.days_in_stage != null && d.expected_days != null && d.days_in_stage > d.expected_days;
  return (
    <section className="rounded-lg border border-border p-3" aria-labelledby={`coach-${recordId}`}>
      <div className="flex items-center justify-between gap-2"><h3 id={`coach-${recordId}`} className="text-sm font-semibold">Next best action</h3><Badge tone="outline"><Sparkles aria-hidden />AI Coach</Badge></div>
      {d.next.text && <p className="mt-1 text-sm">{d.next.text}{d.next.due ? <span className="text-muted-foreground"> · {date(d.next.due, "short")}</span> : ""}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Last contact</dt><dd>{d.last_contact ? date(d.last_contact, "short") : "None logged"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Days at {d.stage}</dt><dd className="tabular-nums">{d.days_in_stage ?? "—"}{d.expected_days ? <span className="text-muted-foreground"> (usually {d.expected_days})</span> : ""}</dd></div>
      </dl>
      {over && d.exit_criteria && <p className="mt-2 text-xs text-muted-foreground">To move on: {d.exit_criteria}.</p>}
      {d.similar.length > 0 && <div className="mt-3">
        <h4 className="text-xs font-semibold text-muted-foreground">Similar past deals</h4>
        <ul className="mt-1 space-y-1 text-sm">{d.similar.map((s, i) => <li key={i}><span className="font-medium">{s.outcome}</span> · {s.who}{s.why ? `: ${s.why}` : ""}{s.lesson ? <span className="text-muted-foreground"> Lesson: {s.lesson}</span> : ""}</li>)}</ul>
      </div>}
    </section>
  );
}
