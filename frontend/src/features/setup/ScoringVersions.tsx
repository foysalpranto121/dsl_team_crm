import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, num, relative } from "@/lib/format";
import { refreshScores, versionsQuery, type RecalcPreview } from "../scoring/api";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const monthText = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** SRS v0.5 §7: history changes only through an explicit, audit-logged recalculation. The preview shows what would move first. */
function RecalcDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: string }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState<RecalcPreview | null>(null);
  useEffect(() => { if (open) { setMonth(""); setReason(""); setShown(null); } }, [open]);
  const preview = useMutation({
    mutationFn: async () => (await api.post<RecalcPreview>("/scoring/recalculate/preview/", { from: month })).data,
    onSuccess: setShown,
  });
  const run = useMutation({
    mutationFn: async () => (await api.post<{ version: number }>("/scoring/recalculate/", { from: month, reason })).data,
    onSuccess: (r) => { refreshScores(qc); onClose(); toast.success(`History recalculated as version ${r.version}`, { description: "It's in the activity log, with your reason." }); },
  });
  const error = preview.error || run.error;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={(e) => { e.preventDefault(); if (shown) run.mutate(); else preview.mutate(); }}>
          <DialogHeader>
            <DialogTitle>Recalculate history</DialogTitle>
            <DialogDescription>Today's points, weights and targets will apply from the month you choose. Finished months and scores can change, so check the preview first.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
              <Field label="From month" required>
                <Input type="month" value={month} max={current.slice(0, 7)} onChange={(e) => { setMonth(e.target.value); setShown(null); }} required /></Field>
              <Field label="Why" required hint="It goes in the activity log."><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cold call points were wrong from the start" required /></Field>
            </div>
            {shown && (shown.rows.length ? (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium"><TriangleAlert className="size-4 text-warning-text" aria-hidden />{shown.rows.length} {shown.rows.length === 1 ? "month changes" : "person-months change"}</p>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-1.5 font-semibold">Person</th><th className="px-3 py-1.5 font-semibold">Month</th><th className="px-3 py-1.5 text-right font-semibold">Points</th><th className="px-3 py-1.5 text-right font-semibold">Score</th></tr></thead>
                    <tbody className="tabular-nums">{shown.rows.map((r) => (
                      <tr key={`${r.person}-${r.month}`} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">{r.person}</td><td className="whitespace-nowrap px-3 py-1.5">{monthText(r.month)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{num(r.points_before)} → {num(r.points_after)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{pct(r.score_before)} → {pct(r.score_after)}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">Nothing would change from {monthText(month)} on. Those months already use today's configuration.</p>)}
            {error && <p className="text-sm text-danger-text" role="alert">{errorText(error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            {shown ? <Button type="submit" variant="danger" busy={run.isPending} disabled={reason.trim().length < 3 || !shown.rows.length}>Recalculate from {monthText(month)}</Button>
              : <Button type="submit" busy={preview.isPending} disabled={!month}>See what would change</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Team setup → Scoring versions (SRS v0.5 FR-C9, FR-S4): every configuration change, from when it applies, and who made it. */
export function ScoringVersions() {
  const q = useQuery(versionsQuery);
  const [all, setAll] = useState(false);
  const [recalc, setRecalc] = useState(false);
  const versions = q.data?.versions ?? [];
  const shown = all ? versions : versions.slice(0, 5);
  return (
    <section className="card p-5" aria-labelledby="versions-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="versions-title" className="flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" aria-hidden />Scoring versions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">A change to points, weights or targets applies from the start of the current month. Finished months keep the numbers they were scored with, unless you recalculate them.</p>
        </div>
        <Button variant="secondary" onClick={() => setRecalc(true)} disabled={!q.data}>Recalculate history…</Button>
      </div>
      {q.isLoading ? <Skeleton className="mt-4 h-24" /> : (
        <ol className="mt-4 divide-y divide-border">
          {shown.map((v) => (
            <li key={v.number} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">Version {v.number}</span>
                <Badge tone={v.kind === "recalc" || v.kind === "restore" ? "warning" : "outline"}>{v.kind_label}</Badge>
                <span className="text-xs text-muted-foreground">{v.effective_from ? `Applies from ${date(v.effective_from, "medium")}` : "Applies from the start"}
                  {v.entries ? ` · ${num(v.entries)} ledger ${v.entries === 1 ? "entry" : "entries"}` : ""} · {v.by ?? "the system"}, {relative(v.created_at)}</span>
              </div>
              {v.reason && <p className="mt-1 text-sm">{v.reason}</p>}
              {v.changes.length > 0 && v.changes[0] !== v.reason && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {v.changes.slice(0, 8).map((c) => <li key={c}>{c}</li>)}{v.changes.length > 8 && <li>and {v.changes.length - 8} more</li>}</ul>}
            </li>
          ))}
        </ol>
      )}
      {versions.length > 5 && <Button size="sm" variant="ghost" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show fewer" : `Show all ${versions.length}`}</Button>}
      <RecalcDialog open={recalc} onClose={() => setRecalc(false)} current={q.data?.current_month ?? ""} />
    </section>
  );
}
