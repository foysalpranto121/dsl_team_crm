import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, ChevronLeft, ChevronRight, Hourglass } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorText } from "@/api/client";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Choice, RadioGroup, RadioGroupItem } from "@/components/ui/form-controls";
import { Field, Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addDays } from "../log/util";
import { refreshProgress, reviewQuery, type Review } from "./api";
import { RecapCard } from "./MyProgress";

function Step({ n, title, done, hint, children }: { n: number; title: string; done: boolean; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-5" aria-labelledby={`step-${n}`}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold", done ? "border-success bg-success text-white" : "border-border text-muted-foreground")}>
          {done ? <Check className="size-4" aria-hidden /> : n}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`step-${n}`} className="text-sm font-semibold">{title}{done && <span className="sr-only"> (done)</span>}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** The Weekly Review (SRS v0.5 FR-WR1): ten minutes on the last working day. Confirm the week's KPI counts and deal statuses, see the recap, pick one focus, submit next week's plan. */
export default function WeeklyReview() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const week = params.get("week"), work = params.get("work");
  const q = useQuery(reviewQuery(week, work));
  const [focus, setFocus] = useState("");
  const [other, setOther] = useState("");
  const d = q.data;
  useEffect(() => {
    if (!d) return;
    const known = d.focus_options.includes(d.focus);
    setFocus(known ? d.focus : d.focus ? "other" : "");
    setOther(known ? "" : d.focus);
  }, [d?.week_start, d?.focus]);   // eslint-disable-line react-hooks/exhaustive-deps
  const act = useMutation({
    mutationFn: async (body: { action: string; focus?: string }) => (await api.post<Review>("/progress/review/", { ...body, week: d!.week_start })).data,
    onSuccess: (r, body) => {
      qc.setQueryData(reviewQuery(week, work).queryKey, r);
      refreshProgress(qc);
      const said: Record<string, string> = { confirm_kpi: "Numbers confirmed", confirm_deals: "Deals confirmed", focus: "Focus saved", submit_plan: "Plan sent for approval", submit: "Review submitted. Have a good weekend." };
      toast.success(said[body.action] ?? "Saved");
    },
    onError: (e) => toast.error("Couldn't do that", { description: errorText(e) }),
  });
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const go = (w: string) => { const p = new URLSearchParams(params); p.set("week", w); setParams(p, { replace: true }); };
  const can = d.mine;
  const chosen = focus === "other" ? other.trim() : focus;
  const n = d.kpi.numbers;
  const tiles: [string, string][] = [["Qualified leads", num(n.leads)], ["Opportunities", num(n.opps)], ["Clients", num(n.clients)], ["Revenue", money(+n.revenue, { compact: true, currency: d.kpi.currency })]];
  return (
    <>
      <PageHeader title={d.mine ? "Weekly Review" : `${d.person}'s weekly review`} subtitle={`Week ${d.week_no} · ${date(d.week_start, "short")} – ${date(d.week_end, "short")}. About ten minutes, on the last working day.`}
        actions={<div className="flex items-center gap-1.5">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => go(addDays(d.week_start, -7))}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label="Next week" disabled={d.current} onClick={() => go(addDays(d.week_start, 7))}><ChevronRight /></Button>
          {d.submitted_at && <Badge tone="success" className="ml-1"><BadgeCheck /> Submitted</Badge>}
        </div>} />
      <div className="mx-auto max-w-3xl space-y-4">
        <Step n={1} title="Your KPI numbers" done={d.steps.kpi} hint={d.kpi.derived ? "Worked out from your pipeline: nothing to type." : "This week's numbers are typed in."}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{tiles.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}</dl>
          {d.kpi.waiting.length > 0 && <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
            {d.kpi.waiting.map((w) => w.company).join(", ")} will count once your supervisor verifies the work order.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {can && d.kpi.derived && !d.kpi.confirmed && <Button size="sm" busy={act.isPending && act.variables?.action === "confirm_kpi"} onClick={() => act.mutate({ action: "confirm_kpi" })}>Confirm these numbers</Button>}
            {d.kpi.derived && d.kpi.confirmed && <span className="text-sm text-muted-foreground">Confirmed.</span>}
            <Button size="sm" variant="ghost" asChild><Link to="/kpi">{d.kpi.derived ? "See the records" : "Enter them on Weekly KPI"}</Link></Button>
          </div>
        </Step>

        <Step n={2} title="Your deals this week" done={d.steps.deals} hint="Put together from your Client Log.">
          {d.deals.length ? <ul className="divide-y divide-border">{d.deals.map((x) => (
            <li key={x.record} className="py-2 text-sm first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2"><Link to={`/tracker?tab=pipeline&record=${x.record}`} className="font-medium hover:underline">{x.company}</Link><span className="text-xs text-muted-foreground">{x.stage}</span></div>
              <div className="text-xs text-muted-foreground">{x.summary}{x.stage_kind === "open" && x.next_action ? ` · Next: ${x.next_action}${x.next_date ? `, ${date(x.next_date, "short")}` : ""}` : ""}</div>
            </li>))}</ul>
            : <EmptyState compact title="No client activity logged this week">Calls, emails and stage moves show up here by themselves.</EmptyState>}
          {can && d.deals.length > 0 && !d.deals_confirmed_at && <Button size="sm" className="mt-3" busy={act.isPending && act.variables?.action === "confirm_deals"} onClick={() => act.mutate({ action: "confirm_deals" })}>That's right</Button>}
          {d.deals_confirmed_at && <p className="mt-2 text-sm text-muted-foreground">Confirmed.</p>}
        </Step>

        <RecapCard r={d.recap} title="The week in short" />

        <Step n={3} title="One focus for next week" done={d.steps.focus} hint={d.last_focus ? `Last week's focus: ${d.last_focus}` : "Just one. It keeps the week simple."}>
          {can ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (chosen.length >= 3) act.mutate({ action: "focus", focus: chosen }); }}>
              <RadioGroup value={focus} onValueChange={setFocus} className="space-y-2" aria-label="One focus">
                {d.focus_options.map((o) => <Choice key={o} control={<RadioGroupItem value={o} />} label={o} />)}
                <Choice control={<RadioGroupItem value="other" />} label="Something else" />
              </RadioGroup>
              {focus === "other" && <Field label="Your focus"><Input value={other} maxLength={300} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Book three demos" autoFocus /></Field>}
              <Button type="submit" size="sm" variant={d.steps.focus ? "secondary" : "primary"} busy={act.isPending && act.variables?.action === "focus"} disabled={chosen.length < 3 || chosen === d.focus}>Save focus</Button>
            </form>
          ) : <p className="text-sm">{d.focus || "Not picked yet."}</p>}
        </Step>

        <Step n={4} title="Next week's plan" done={d.steps.plan} hint={`Week of ${date(d.next_plan.week_start, "short")}: ${num(d.next_plan.planned_hours)} of ${num(d.next_plan.target_hours)} target hours planned. ${d.next_plan.status_label}.`}>
          <div className="flex flex-wrap items-center gap-2">
            {can && d.next_plan.unsent_hours > 0 && <Button size="sm" busy={act.isPending && act.variables?.action === "submit_plan"} onClick={() => act.mutate({ action: "submit_plan" })}>Send {num(d.next_plan.unsent_hours)} planned {d.next_plan.unsent_hours === 1 ? "hour" : "hours"} for approval</Button>}
            <Button size="sm" variant={can && !d.next_plan.planned_hours ? "primary" : "secondary"} asChild><Link to={`/my-day?tab=plan&day=${d.next_plan.week_start}${d.mine ? "" : `&work=${d.work}`}`}>{d.next_plan.planned_hours ? "Open the plan" : "Plan next week"}</Link></Button>
          </div>
        </Step>

        {can && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <p className="min-w-0 flex-1 basis-56 text-sm">{d.submitted_at ? `Submitted ${new Date(d.submitted_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Your supervisor sees it in the team review.` : d.ready ? "All four done." : "Finish the four steps to submit your review."}</p>
            {!d.submitted_at && <Button busy={act.isPending && act.variables?.action === "submit"} disabled={!d.ready} onClick={() => act.mutate({ action: "submit" })}>Submit my review</Button>}
          </div>
        )}
      </div>
    </>
  );
}
