import { ArrowLeft, FlaskConical } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/ui";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CURRENCY, DEFAULT_THRESHOLDS, METRICS, SAMPLE_TODAY_LABEL, statusOf, type MetricKey, type Slot, type Thresholds } from "./mock";

/* What every Preview screen shares: the "Sample data" notice, the status pill, slot chips and the drill-down. */

export const sample = (what: string) => toast(what, { description: "Sample only: nothing was saved." });
export const pctOf = (r: number | null | undefined) => (r == null ? "—" : `${Math.round(r * 100)}%`);
export const showMetric = (key: MetricKey, v: number) => (key === "revenue" ? money(v, { compact: true, currency: CURRENCY }) : num(v));
export const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground";
export const TH_NUM = "whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-muted-foreground";

export function SampleBanner() {
  return (
    <div role="note" data-sample-banner className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning-text">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span><strong className="font-semibold">Sample data.</strong> These people and numbers are made up, shown as if today were {SAMPLE_TODAY_LABEL}. Nothing here is saved.</span>
    </div>
  );
}

/* ---------- drill-down: every number opens the entries behind it (SRS FR-S3) ---------- */
interface DrillTarget { title: string; metric: MetricKey; value: number; who: string }
const DrillContext = createContext<(t: DrillTarget) => void>(() => undefined);

const ACTIVITY_FOR: Record<MetricKey, string[]> = {
  hours: ["Week of 3 Oct", "Week of 10 Oct", "Week of 17 Oct", "Week of 24 Oct"], points: ["Make 8 Cold Calls", "Prepare Proposal", "Demo & Presentation Session", "Follow-up Calls", "Find 10 New Leads"],
  leads: ["Meghna Textiles", "Padma Foods", "Rupsha Logistics", "Jamuna Pharma", "Teesta Agro"], opps: ["Meghna Textiles", "Padma Foods", "Rupsha Logistics"], clients: ["Meghna Textiles", "Jamuna Pharma"], revenue: ["Meghna Textiles", "Jamuna Pharma"],
};
/** Sample rows that add up to exactly the number on screen. */
function rowsFor(t: DrillTarget) {
  const names = ACTIVITY_FOR[t.metric];
  const count = t.metric === "hours" ? 4 : t.metric === "points" ? 5 : t.metric === "revenue" || t.metric === "clients" ? Math.max(1, Math.min(2, Math.round(t.value) || 1)) : Math.min(5, Math.max(1, Math.round(t.value)));
  const total = t.metric === "hours" ? t.value * 4 : t.value;   // hours are an average a week, so the weeks add up to four times that
  const each = t.metric === "leads" || t.metric === "opps" || t.metric === "clients" ? 1 : Math.floor(total / count);
  const rows = Array.from({ length: count }, (_, i) => ({ id: i, name: names[i % names.length], day: `${28 - i * 5} Oct`, value: each }));
  if (each !== 1) rows[0].value = total - each * (count - 1);
  return { rows, more: t.metric === "leads" || t.metric === "opps" ? Math.max(0, Math.round(t.value) - count) : 0, total };
}

function LedgerSheet({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const d = target ? rowsFor(target) : null;
  const metric = target ? METRICS.find((m) => m.key === target.metric)! : null;
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>{target?.title}</SheetTitle><SheetDescription>{target?.who}. {metric?.means}</SheetDescription></SheetHeader>
        <SheetBody>
          {target && d && (
            <>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border"><th className={cn(TH, "pl-0")}>Entry</th><th className={TH}>Day</th><th className={cn(TH_NUM, "pr-0")}>{target.metric === "revenue" ? "Value" : metric?.label}</th></tr></thead>
                <tbody className="tabular-nums">
                  {d.rows.map((r) => <tr key={r.id} className="border-b border-border"><td className="py-2 pr-3">{r.name}</td><td className="px-3 py-2 text-muted-foreground">{r.day}</td><td className="py-2 text-right">{showMetric(target.metric, r.value)}</td></tr>)}
                  {d.more > 0 && <tr className="border-b border-border"><td colSpan={2} className="py-2 pr-3 text-muted-foreground">{d.more} more entries</td><td className="py-2 text-right">{showMetric(target.metric, d.more)}</td></tr>}
                </tbody>
                <tfoot className="tabular-nums"><tr><th scope="row" className="py-2 pr-3 text-left font-semibold">Total</th><td /><td data-drill-total className="py-2 text-right font-semibold">{showMetric(target.metric, d.total)}</td></tr></tfoot>
              </table>
              {target.metric === "hours" && <p className="mt-3 text-xs text-muted-foreground">An average of {num(target.value)} a week over four weeks.</p>}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** A number you can open. */
export function Drill({ metric, value, who, title, children, className }: { metric: MetricKey; value: number; who: string; title: string; children: ReactNode; className?: string }) {
  const open = useContext(DrillContext);
  return (
    <button type="button" onClick={() => open({ metric, value, who, title })} aria-label={`${title}, ${who}: see the entries`}
      className={cn("rounded-sm tabular-nums underline decoration-subtle-foreground decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", className)}>{children}</button>
  );
}

export function PreviewPage({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: ReactNode; children: ReactNode }) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  return (
    <DrillContext.Provider value={setTarget}>
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild><Link to="/preview"><ArrowLeft /> All previews</Link></Button>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <SampleBanner />
      {children}
      <LedgerSheet target={target} onClose={() => setTarget(null)} />
    </DrillContext.Provider>
  );
}

export function ScorePill({ ratio, thresholds = DEFAULT_THRESHOLDS }: { ratio: number; thresholds?: Thresholds }) {
  const s = statusOf(ratio, thresholds);
  return <StatusPill status={s.status as Status}>{s.label}</StatusPill>;
}

/** A wide table scrolls by itself on a phone, and the keyboard can reach it. */
export function ScrollX({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden", className)}>{children}</div>;
}

export function CardTitle({ id, title, note, action }: { id: string; title: string; note?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-5 py-3">
      <div className="min-w-0"><h2 id={id} className="text-sm font-semibold">{title}</h2>{note && <p className="text-xs text-muted-foreground">{note}</p>}</div>
      {action}
    </div>
  );
}

const SLOT_LOOK: Record<Slot["state"], { cls: string; word: string }> = {
  done: { cls: "border-success/30 bg-success-soft text-success-text", word: "Done" },
  planned: { cls: "border-border bg-card text-foreground", word: "Planned" },
  deviation: { cls: "border-warning/40 bg-warning-soft text-warning-text", word: "Waiting for a decision" },
  empty: { cls: "border-dashed border-input bg-transparent text-muted-foreground", word: "Empty" },
};
/** The slot chip grid (SRS §10.4): H-1 to H-10, with a word for each state, never colour alone. */
export function SlotChips({ slots, onPick, picked, className }: { slots: Slot[]; onPick?: (s: Slot) => void; picked?: string | null; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2 sm:grid-cols-5", className)}>
      {slots.map((s) => {
        const look = SLOT_LOOK[s.state];
        const inner = (<><span className="block text-xs font-semibold">{s.id}</span><span className="mt-0.5 block truncate text-xs">{s.activity ?? "Not planned"}</span><span className="block text-[11px] opacity-90">{look.word}</span></>);
        const cls = cn("block w-full rounded-lg border px-2.5 py-2 text-left", look.cls, picked === s.id && "ring-2 ring-primary");
        return <li key={s.id} className="min-w-0">{onPick ? <button type="button" onClick={() => onPick(s)} className={cn(cls, "transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden")}>{inner}</button> : <div className={cls}>{inner}</div>}</li>;
      })}
    </ul>
  );
}
