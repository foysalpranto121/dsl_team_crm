import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, Plus, Stamp } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { date, num } from "@/lib/format";
import { fieldErrors } from "../pipeline/dialogs";
import { pendingEventsQuery, refreshScores, type ScoreEvent } from "./api";

const STATUS = { pending: "info", verified: "good", rejected: "danger" } as const;

/** FR-T5, D2: logged with evidence; it counts once a supervisor verifies it, and adds points, not hours. */
function LogEventDialog({ open, onClose, sheet, day, choices }: { open: boolean; onClose: () => void; sheet: number; day: string; choices: { id: number; name: string; points: number }[] }) {
  const qc = useQueryClient();
  const blank = { activity: "", quantity: "1", evidence: "", note: "" };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF({ ...blank, activity: choices.length === 1 ? String(choices[0].id) : "" }); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => (await api.post<ScoreEvent>("/scoring/events/", { sheet, day, activity: Number(f.activity), quantity: Number(f.quantity) || 1, evidence: f.evidence, note: f.note })).data,
    onSuccess: (e) => { refreshScores(qc); onClose(); toast.success("Event logged", { description: `It adds ${num(e.points)} points once your supervisor verifies it.` }); },
  });
  const err = fieldErrors(save.error);
  const chosen = choices.find((c) => String(c.id) === f.activity);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Log an event</DialogTitle>
            <DialogDescription>For {date(day, "short")}. It counts once your supervisor verifies the evidence. It adds points, not hours.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Event" required error={err.activity}>
              <SimpleSelect value={f.activity} onValueChange={(v) => setF({ ...f, activity: v })} placeholder="Choose one" aria-label="Event"
                options={choices.map((c) => ({ value: String(c.id), label: `${c.name} · ${num(c.points)} pts` }))} /></Field>
            <Field label="How many" required error={err.quantity} hint={chosen ? `${num(chosen.points * (Number(f.quantity) || 0))} points in all` : undefined}>
              <Input type="number" min={1} max={1000} inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></Field>
            <Field label="Evidence" required error={err.evidence} hint="A reference or link your supervisor can check.">
              <Input value={f.evidence} maxLength={300} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="e.g. WO-2026-114 or a link" required /></Field>
            <Field label="Note"><Textarea value={f.note} maxLength={500} className="min-h-14" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            {save.error && !Object.keys(err).some((k) => ["activity", "quantity", "evidence"].includes(k)) && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!f.activity || f.evidence.trim().length < 3}>Log event</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** My Day: the day's events and, where the person has any event activities, logging one. */
export function DayEvents({ sheet, day, events, choices, editable }: { sheet: number; day: string; events: ScoreEvent[]; choices: { id: number; name: string; points: number }[]; editable: boolean }) {
  const qc = useQueryClient();
  const [logging, setLogging] = useState(false);
  const withdraw = useMutation({
    mutationFn: async (id: number) => api.delete(`/scoring/events/${id}/`),
    onSuccess: () => { refreshScores(qc); toast.success("Event withdrawn"); },
    onError: (e) => toast.error("Couldn't withdraw it", { description: errorText(e) }),
  });
  if (!events.length && !(editable && choices.length)) return null;
  return (
    <section className="border-t border-border px-5 py-4" aria-labelledby="day-events">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="day-events" className="text-sm font-semibold">Events</h3>
        {editable && choices.length > 0 && <Button size="sm" variant="secondary" onClick={() => setLogging(true)}><Plus /> Log an event</Button>}
      </div>
      {events.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Stamp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.activity_name}{e.quantity > 1 ? ` × ${e.quantity}` : ""} <span className="font-normal tabular-nums text-muted-foreground">· {num(e.points)} pts</span></div>
                <div className="text-xs text-muted-foreground">{e.company ?? e.evidence}{e.decision_note ? ` · ${e.decision_note}` : ""}</div>
              </div>
              <StatusPill status={STATUS[e.status]}>{e.status_label}</StatusPill>
              {e.status === "pending" && e.mine && <Button size="sm" variant="ghost" onClick={() => withdraw.mutate(e.id)}>Withdraw</Button>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-muted-foreground">Things that count on their own, not by the hour. They add points once verified.</p>}
      <LogEventDialog open={logging} onClose={() => setLogging(false)} sheet={sheet} day={day} choices={choices} />
    </section>
  );
}

/** Team Board: events waiting for a supervisor (D2). Nobody verifies their own. */
export function EventsPanel() {
  const qc = useQueryClient();
  const q = useQuery(pendingEventsQuery);
  const [rejecting, setRejecting] = useState<ScoreEvent | null>(null);
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: async (a: { id: number; verified: boolean; note?: string }) => api.post(`/scoring/events/${a.id}/decide/`, { verified: a.verified, note: a.note ?? "" }),
    onSuccess: (_, a) => { refreshScores(qc); setRejecting(null); setNote(""); toast.success(a.verified ? "Verified" : "Sent back", { description: a.verified ? "Its points count from its own date." : undefined }); },
    onError: (e) => toast.error("Couldn't save that", { description: errorText(e) }),
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="card mb-5 overflow-hidden" aria-labelledby="events-title">
      <h2 id="events-title" className="border-b border-border px-5 py-3 text-sm font-semibold">Events to verify <span className="font-normal text-muted-foreground">· {rows.length}</span></h2>
      <ul className="divide-y divide-border">
        {rows.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <BadgeCheck className="size-4 shrink-0 text-primary-text" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{e.activity_name}{e.quantity > 1 ? ` × ${e.quantity}` : ""} <span className="font-normal text-muted-foreground">· {e.person} · {num(e.points)} pts</span></div>
              <div className="text-xs text-muted-foreground"><CalendarClock className="mr-1 inline size-3" aria-hidden />{date(e.day, "short")} · Evidence: {e.evidence}{e.note ? ` · ${e.note}` : ""}</div>
            </div>
            {e.mine ? <Badge tone="outline">Yours: someone else verifies it</Badge> : <>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(e)}>Not verified</Button>
              <Button size="sm" busy={act.isPending && act.variables?.id === e.id} onClick={() => act.mutate({ id: e.id, verified: true })}>Verify</Button>
            </>}
          </li>
        ))}
      </ul>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); if (rejecting) act.mutate({ id: rejecting.id, verified: false, note }); }}>
            <DialogHeader><DialogTitle>Don't verify this event?</DialogTitle><DialogDescription>Say what's missing, so {rejecting?.person} can fix it.</DialogDescription></DialogHeader>
            <DialogBody><Field label="What's missing" required><Textarea value={note} maxLength={300} className="min-h-16" onChange={(e) => setNote(e.target.value)} required /></Field></DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" busy={act.isPending} disabled={note.trim().length < 3}>Send back</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
