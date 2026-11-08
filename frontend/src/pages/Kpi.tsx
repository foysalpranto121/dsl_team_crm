import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, BadgeCheck, CalendarCheck2, Check, ChevronLeft, ChevronRight, CircleAlert, Flag, Info, Lock, PencilLine, Workflow } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, errorText } from "../api/client";
import type { DashboardRow } from "../api/types";
import { EmptyState, ErrorState } from "../components/data/states";
import { PageHeader } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Field, Input, Textarea } from "../components/ui/input";
import { Progress } from "../components/ui/progress";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "../components/ui/toaster";
import { Tip } from "../components/ui/tooltip";
import { configQuery, type Evidence, type KpiKey, type Reviews } from "../features/pipeline/api";
import { date, money } from "../lib/format";
import { cn } from "../lib/utils";

/* SRS v0.5 FR-K2, FR-K3, FR-K5: weekly KPIs worked out from the pipeline. A record counts once per KPI, in the week it first
   reaches the bound stage; Clients and Revenue need the win verified. Members confirm their week; supervisors adjust with a note. */

type Nums = Record<KpiKey, number>;
interface Kpi {
  week_start: string; leads: number; opps: number; clients: number; revenue: string; notes: string; updated_by: string | null; updated_at: string;
  source: "typed" | "derived"; derived: Partial<Nums>; adjust: Partial<Nums>; adjust_note: string; adjusted_by: string | null; adjusted_at: string | null;
  confirmed: Partial<Nums>; confirmed_by: string | null; confirmed_at: string | null; stale: boolean;
}
interface KpiRow { sheet: number; name: string; person: string; role: string | null; mine: boolean; editable: boolean; blocked: string | null; has_owner: boolean;
  kpi: Kpi | null; renewals: number; targets: Nums }
interface KpiWeek { week_start: string; week_end: string; week_no: number; today: string; current_week_start: string; counts_in_month: string; rows: KpiRow[];
  derived: boolean; kpi_mode: "derived" | "manual"; kpi_from: string | null; can_adjust: boolean }

const KEYS: KpiKey[] = ["leads", "opps", "clients", "revenue"];
const LABEL: Record<KpiKey, string> = { leads: "Qualified leads", opps: "Opportunities", clients: "Clients", revenue: "Revenue" };
const shift = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthName = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const val = (k: Kpi | null, key: KpiKey) => (k ? (key === "revenue" ? +k.revenue : k[key]) : 0);
const fmtVal = (key: KpiKey, v: number) => (key === "revenue" ? money(v, { currency: null }) : String(v));
const invalidate = (qc: ReturnType<typeof useQueryClient>) => ["kpi-week", "kpi-evidence", "dashboard", "performance", "pipeline-reviews", "tracker"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/** A typed week (manual mode, or before the cut-over): the old inline editing, labelled as unevidenced. */
function TypedCells({ row, week }: { row: KpiRow; week: string }) {
  const qc = useQueryClient();
  const init = { leads: String(row.kpi?.leads ?? 0), opps: String(row.kpi?.opps ?? 0), clients: String(row.kpi?.clients ?? 0), revenue: String(Math.round(+(row.kpi?.revenue ?? 0))) };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const save = useMutation({
    mutationFn: async () => (await api.put(`/team/sheets/${row.sheet}/kpis/${week}/`, { leads: +f.leads || 0, opps: +f.opps || 0, clients: +f.clients || 0, revenue: f.revenue || "0" })).data,
    onSuccess: () => { invalidate(qc); toast.success("Saved"); },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  return (
    <>
      {KEYS.map((k) => (
        <td key={k} className="px-3 py-2 text-right">
          <Input type="number" min={0} step={k === "revenue" ? 1000 : 1} value={f[k]} aria-label={`${LABEL[k]} for ${row.person}`}
            onChange={(e) => setF({ ...f, [k]: e.target.value })} className={cn("num ml-auto h-8 text-right", k === "revenue" ? "w-28" : "w-20")} />
        </td>
      ))}
      <td className="px-3 py-2"><Badge tone="outline">Typed in</Badge></td>
      <td className="px-3 py-2 text-right"><Button size="sm" onClick={() => save.mutate()} busy={save.isPending} disabled={!dirty}>Save</Button></td>
    </>
  );
}

function Status({ k, derived }: { k: Kpi | null; derived: boolean }) {
  if (!derived) return k?.source === "typed" ? <Badge tone="outline">Typed in</Badge> : <span className="text-xs text-subtle-foreground">—</span>;
  if (!k?.confirmed_at) return <Badge tone="neutral">Not confirmed</Badge>;
  if (k.stale) return <Tip content={`Confirmed by ${k.confirmed_by}; the pipeline changed since.`}><span><Badge tone="warning"><CircleAlert /> Changed since confirmed</Badge></span></Tip>;
  return <Tip content={`Confirmed by ${k.confirmed_by} on ${date(k.confirmed_at.slice(0, 10), "short")}`}><span><Badge tone="success"><Check /> Confirmed</Badge></span></Tip>;
}

function Num({ k, keyName, row }: { k: Kpi | null; keyName: KpiKey; row: KpiRow }) {
  const v = val(k, keyName), adj = k?.adjust?.[keyName];
  return (
    <td className="num px-3 py-2.5 text-right">
      {k ? fmtVal(keyName, v) : <span className="text-subtle-foreground">0</span>}
      {!!adj && <Tip content={`Adjusted ${adj > 0 ? "+" : ""}${fmtVal(keyName, adj)} by ${k?.adjusted_by}: ${k?.adjust_note}`}>
        <PencilLine className="ml-1 inline size-3 text-warning-text" aria-label={`Adjusted by ${k?.adjusted_by}`} /></Tip>}
      {keyName === "revenue" && row.renewals > 0 && <Link to="/renewals?tab=renew" className="block text-[11px] font-medium text-success-text hover:underline">+ {money(row.renewals, { currency: null })} renewals</Link>}
    </td>
  );
}

/** FR-K2: the team leader adjusts a week's numbers, with a note (audit-logged). Stored as a change on top of the pipeline. */
function AdjustDialog({ row, week, onClose }: { row: KpiRow | null; week: string; onClose: () => void }) {
  const qc = useQueryClient();
  const k = row?.kpi ?? null;
  const [f, setF] = useState<Record<KpiKey, string> & { note: string }>({ leads: "", opps: "", clients: "", revenue: "", note: "" });
  const [shownFor, setShownFor] = useState<number | null>(null);
  if (row && shownFor !== row.sheet) {
    setShownFor(row.sheet);
    setF({ leads: String(val(k, "leads")), opps: String(val(k, "opps")), clients: String(val(k, "clients")), revenue: String(val(k, "revenue")), note: k?.adjust_note ?? "" });
  }
  const save = useMutation({
    mutationFn: async () => (await api.post(`/team/sheets/${row!.sheet}/kpis/${week}/adjust/`, { leads: +f.leads, opps: +f.opps, clients: +f.clients, revenue: f.revenue || "0", note: f.note })).data,
    onSuccess: () => { invalidate(qc); toast.success(`${row!.person}'s week adjusted`, { description: "The change and your note are in the activity log." }); close(); },
  });
  const close = () => { setShownFor(null); save.reset(); onClose(); };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Adjust {row?.person}'s week</DialogTitle>
            <DialogDescription>Set the right numbers. The pipeline's own count stays visible, and later pipeline changes still add on top.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {KEYS.map((key) => <Field key={key} label={LABEL[key]} hint={`Pipeline: ${fmtVal(key, k?.derived?.[key] ?? 0)}`}>
                <Input type="number" min={0} step={key === "revenue" ? "any" : 1} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="num" /></Field>)}
            </div>
            <Field label="Why" required><Textarea value={f.note} maxLength={300} className="min-h-16" onChange={(e) => setF({ ...f, note: e.target.value })} required placeholder="e.g. Two leads were added a week late" /></Field>
            {save.error && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" busy={save.isPending} disabled={f.note.trim().length < 3}>Save adjustment</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The records behind a week's numbers (SRS §11: every number drills down). */
function EvidenceSheet({ row, week, onClose }: { row: KpiRow | null; week: string; onClose: () => void }) {
  const ev = useQuery({ queryKey: ["kpi-evidence", row?.sheet, week], enabled: !!row,
    queryFn: async () => (await api.get<Evidence>(`/team/sheets/${row!.sheet}/kpis/${week}/evidence/`)).data });
  const cfg = useQuery(configQuery).data;
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader><SheetTitle>{row?.person}: the records behind the numbers</SheetTitle>
          <SheetDescription>Week of {date(week, "long")}. A record counts once for each KPI, in the week it first reaches the stage.</SheetDescription></SheetHeader>
        <SheetBody className="space-y-5">
          {ev.error ? <ErrorState error={ev.error} onRetry={() => ev.refetch()} /> : !ev.data ? <Skeleton className="h-48" /> : <>
            {KEYS.map((key) => {
              const def = cfg?.kpi_types.find((t) => t.key === key);
              const items = ev.data.counted[key] ?? [];
              return (
                <section key={key} aria-labelledby={`ev-${key}`}>
                  <h3 id={`ev-${key}`} className="flex items-baseline justify-between text-sm font-semibold">{def?.name ?? LABEL[key]}
                    <span className="num text-muted-foreground">{key === "revenue" ? money(items.reduce((s, x) => s + (x.value ?? 0), 0), { currency: null }) : items.length}</span></h3>
                  {def && <p className="text-xs text-muted-foreground">{def.definition}</p>}
                  {items.length ? <ul className="mt-2 divide-y divide-border rounded-lg border border-border">{items.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="truncate">{x.company}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{key === "revenue" && x.value != null ? `${money(x.value, { currency: null })} · ` : ""}{date(x.day, "short")}</span></li>))}</ul>
                    : <p className="mt-1 text-xs text-subtle-foreground">None this week.</p>}
                </section>
              );
            })}
            {ev.data.waiting.length > 0 && <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-warning-text">
              <div className="font-medium">Waiting for the work order to be verified</div>
              <div className="text-foreground/80">{ev.data.waiting.map((w) => w.company).join(", ")}: these count as clients and revenue once a supervisor verifies them.</div></div>}
          </>}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** FR-K2 for supervisors: backward stage moves to look at, and wins whose work order needs verifying. */
function ReviewPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pipeline-reviews"], queryFn: async () => (await api.get<Reviews>("/tracker/reviews/")).data });
  const [rejecting, setRejecting] = useState<{ id: number; company: string } | null>(null);
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: async (a: { kind: "move" | "win" | "stage"; id: number; verified?: boolean; note?: string }) =>
      api.post(a.kind === "move" ? `/tracker/reviews/moves/${a.id}/` : a.kind === "stage" ? `/frameworks/reviews/${a.id}/` : `/tracker/reviews/wins/${a.id}/`,
        { verified: a.verified, note: a.note ?? "" }),
    onSuccess: (_, a) => { invalidate(qc); setRejecting(null); setNote("");
      if (a.kind === "stage") qc.invalidateQueries({ queryKey: ["frameworks"] });
      toast.success(a.kind !== "win" ? "Marked as reviewed" : a.verified ? "Win verified" : "Sent back", { description: a.kind === "win" && a.verified ? "It now counts as a client and as revenue." : undefined }); },
    onError: (e) => toast.error("Couldn't save that", { description: errorText(e) }),
  });
  if (!q.data || (q.data.moves.length === 0 && q.data.wins.length === 0 && !q.data.stages?.length)) return null;
  const d = q.data, flagged = d.stages ?? [];
  return (
    <section className="card overflow-hidden" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="border-b border-border px-5 py-3 text-sm font-semibold">Needs your review <span className="font-normal text-muted-foreground">· {d.wins.length + d.moves.length + flagged.length}</span></h2>
      <ul className="divide-y divide-border">
        {d.wins.map((w) => (
          <li key={`w${w.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <BadgeCheck className="size-4 shrink-0 text-success-text" aria-hidden />
            <div className="min-w-0 flex-1"><div className="font-medium">{w.company} won <span className="font-normal text-muted-foreground">· {w.person}{w.value != null ? ` · ${money(w.value, { currency: null })}` : ""}</span></div>
              <div className="truncate text-xs text-muted-foreground">{w.requirement}{w.why ? ` · Why: ${w.why}` : ""}</div></div>
            <Button size="sm" variant="secondary" onClick={() => setRejecting({ id: w.id, company: w.company })}>Not verified</Button>
            <Button size="sm" onClick={() => act.mutate({ kind: "win", id: w.id, verified: true })}>Verify work order</Button>
          </li>
        ))}
        {d.moves.map((m) => (
          <li key={`m${m.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <ArrowDownLeft className="size-4 shrink-0 text-warning-text" aria-hidden />
            <div className="min-w-0 flex-1"><div className="font-medium">{m.company} moved back <span className="font-normal text-muted-foreground">· {m.person}</span></div>
              <div className="text-xs text-muted-foreground">{m.from} → {m.to} on {date(m.day, "short")}. Counts don't change; check it's right.</div></div>
            <Button size="sm" variant="secondary" onClick={() => act.mutate({ kind: "move", id: m.id, note: "Reviewed" })}>Mark reviewed</Button>
          </li>
        ))}
        {flagged.map((s) => (
          <li key={`s${s.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <Flag className="size-4 shrink-0 text-warning-text" aria-hidden />
            <div className="min-w-0 flex-1"><div className="font-medium">{s.company}: stage review <span className="font-normal text-muted-foreground">· {s.person}</span></div>
              <div className="text-xs text-muted-foreground">{s.note} ({s.framework}). Check the record is still at the right stage.</div></div>
            <Button size="sm" variant="secondary" onClick={() => act.mutate({ kind: "stage", id: s.id, note: "Reviewed" })}>Mark reviewed</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); if (rejecting) act.mutate({ kind: "win", id: rejecting.id, verified: false, note }); }}>
            <DialogHeader><DialogTitle>Don't verify {rejecting?.company}?</DialogTitle><DialogDescription>Say what's missing; it goes into the record's Client Log.</DialogDescription></DialogHeader>
            <DialogBody><Field label="What's missing" required><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" required placeholder="e.g. No signed work order attached yet" /></Field></DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" busy={act.isPending} disabled={note.trim().length < 3}>Send back</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ModeNote({ d }: { d: KpiWeek }) {
  const box = (icon: ReactNode, cls: string, children: ReactNode) => <div className={cn("flex gap-2.5 rounded-lg border px-4 py-3 text-sm", cls)}>{icon}<div>{children}</div></div>;
  if (d.derived) return box(<Workflow className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />, "border-primary/20 bg-primary-soft/60",
    <>Worked out from the pipeline: a record counts in the week it first reaches a stage, and wins count once the work order is verified. Nothing to type.
      Open a person's numbers to see the records behind them.</>);
  if (d.kpi_mode === "manual") return box(<CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />, "border-warning/30 bg-warning-soft/60",
    <>Typed in each week (manual mode). These numbers have no pipeline records behind them. An admin can switch to pipeline counting in Team setup.</>);
  return box(<Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />, "border-border bg-muted/50",
    <>This week is before {d.kpi_from ? date(d.kpi_from, "long") : "the cut-over"}, so it keeps the numbers typed in. From then on they're worked out from the pipeline.</>);
}

export default function KpiPage() {
  const qc = useQueryClient();
  const [week, setWeek] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["kpi-week", week], queryFn: async () => (await api.get<KpiWeek>(`/team/kpi-week/${week ? `?week=${week}` : ""}`)).data, placeholderData: (p) => p });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: async () => (await api.get<{ rows: DashboardRow[] }>("/team/dashboard/")).data });
  const [evidence, setEvidence] = useState<KpiRow | null>(null);
  const [adjusting, setAdjusting] = useState<KpiRow | null>(null);
  const confirm = useMutation({
    mutationFn: async (row: KpiRow) => (await api.post(`/team/sheets/${row.sheet}/kpis/${q.data!.week_start}/confirm/`)).data,
    onSuccess: () => { invalidate(qc); toast.success("Week confirmed", { description: "If the pipeline changes later, you'll see it here." }); },
    onError: (e) => toast.error("Couldn't confirm", { description: errorText(e) }),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  const isCurrent = d.week_start === d.current_week_start;
  const started = d.week_start <= d.today;

  return (
    <>
      <PageHeader title="Weekly KPI" subtitle={`Qualified leads, opportunities, clients and revenue per week. This week counts in ${monthName(d.counts_in_month)}.`}
        actions={<div className="flex items-center gap-1">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => setWeek(shift(d.week_start, -7))}><ChevronLeft /></Button>
          <span className="min-w-44 text-center text-sm font-semibold">Week {d.week_no} · {date(d.week_start, "short")} – {date(d.week_end, "short")}</span>
          <Button variant="secondary" size="icon" aria-label="Next week" onClick={() => setWeek(shift(d.week_start, 7))} disabled={d.week_start >= d.current_week_start}><ChevronRight /></Button>
          {!isCurrent && <Button variant="ghost" onClick={() => setWeek(null)}>This week</Button>}
        </div>} />

      <div className="space-y-5">
        <ModeNote d={d} />
        {d.can_adjust && <ReviewPanel />}
        {d.rows.length === 0 ? <div className="card"><EmptyState icon={<CalendarCheck2 />} title="No work logs yet">Create work logs in Team setup first.</EmptyState></div> : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <caption className="sr-only">Weekly KPIs, week of {date(d.week_start, "long")}</caption>
                <thead><tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
                  {KEYS.map((k) => <th key={k} scope="col" className="px-3 py-2.5 text-right font-medium">{LABEL[k]}{k === "revenue" ? " (BDT)" : ""}</th>)}
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th><th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-border">{d.rows.map((r) => (
                  <tr key={`${r.sheet}-${d.week_start}-${r.kpi?.updated_at ?? ""}`} className={cn(r.mine && "bg-primary-soft/30")}>
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <div className="flex items-center gap-1.5 font-medium">{r.person}{r.mine && <Badge tone="primary">You</Badge>}</div>
                      <div className="text-xs text-muted-foreground">{r.role ?? "No job role"}</div>
                    </th>
                    {!d.derived && r.editable ? <TypedCells row={r} week={d.week_start} /> : <>
                      {KEYS.map((k) => <Num key={k} k={r.kpi} keyName={k} row={r} />)}
                      <td className="px-3 py-2.5"><Status k={r.kpi} derived={d.derived} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {d.derived && r.has_owner && (r.mine || d.can_adjust) && <Button size="sm" variant="ghost" onClick={() => setEvidence(r)}>Records</Button>}
                          {d.derived && r.mine && started && (!r.kpi?.confirmed_at || r.kpi.stale) &&
                            <Button size="sm" onClick={() => confirm.mutate(r)} busy={confirm.isPending && confirm.variables?.sheet === r.sheet}>Confirm</Button>}
                          {d.derived && d.can_adjust && !r.mine && r.has_owner && <Button size="sm" variant="secondary" onClick={() => setAdjusting(r)}>Adjust</Button>}
                          {!d.derived && !r.editable && <Tip content={r.blocked ?? "Locked"}><span className="p-1.5 text-subtle-foreground"><Lock className="size-4" aria-label={r.blocked ?? "Locked"} /></span></Tip>}
                        </div>
                      </td>
                    </>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {dash.data && dash.data.rows.length > 0 && (
          <section className="card p-5" aria-labelledby="month-title">
            <h2 id="month-title" className="text-sm font-semibold">This month so far, against monthly targets</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {dash.data.rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-4">
                  <div className="font-medium">{r.person || r.name}</div>
                  {KEYS.map((k) => {
                    const v = r.kpi_month[k], t = r.kpi_targets[k];
                    return (
                      <div key={k} className="mt-2.5">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>{LABEL[k]}</span>
                          <span className="num">{fmtVal(k, v)} / {t > 0 ? fmtVal(k, t) : "—"}</span></div>
                        <Progress className="mt-1" size="sm" value={t > 0 ? Math.min(v, t) : 0} max={t > 0 ? t : 1} tone={t > 0 && v >= t ? "success" : "primary"} label={`${LABEL[k]} for ${r.person || r.name}`} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <EvidenceSheet row={evidence} week={d.week_start} onClose={() => setEvidence(null)} />
      <AdjustDialog row={adjusting} week={d.week_start} onClose={() => setAdjusting(null)} />
    </>
  );
}
