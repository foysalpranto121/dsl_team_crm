import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, errorText } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Avatar } from "@/components/Brand";
import { ErrorState } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, money } from "@/lib/format";
import { KEY, OPEN_STAGES, STAGE_TONE, endsText, nextTerm, teamToday, urgency, type OpenStage, type Renewal } from "./types";

/** Working one renewal: the contract, the next step, and recording the outcome (SRS FR-RN2). */

const REASONS = ["Price too high", "Moved to a competitor", "No longer needs it", "Budget cut", "Business closed"];
/** Renewing changes revenue, so the team numbers are fetched again too. */
const REVENUE_KEYS = [["dashboard"], ["kpi-week"], ["performance"], ["huddle"]];

function useRefresh() {
  const qc = useQueryClient();
  return (revenue = false) => {
    qc.invalidateQueries({ queryKey: KEY });
    if (revenue) REVENUE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  };
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

// ---------- the client renewed ----------

function RenewDialog({ r, open, onOpenChange }: { r: Renewal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const refresh = useRefresh();
  const c = r.contract;
  const today = teamToday(c.end_date, r.days_left);
  const term = nextTerm(c.start_date, c.end_date);
  const [f, setF] = useState({ start: term.start, end: term.end, value: String(Math.round(+r.value)), terms: c.terms, on: today });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const isAdmin = user?.role === "admin";
  const bad = !f.start || !f.end || f.end < f.start ? "The new term must end after it starts." : f.value === "" || +f.value < 0 ? "Enter the value of the new term." : null;
  const save = useMutation({
    mutationFn: async () => (await api.post<Renewal>(`/renewals/opportunities/${r.id}/renew/`, {
      start_date: f.start, end_date: f.end, value: f.value, terms: f.terms.trim(), ...(isAdmin ? { renewed_on: f.on } : {}),
    })).data,
    onSuccess: () => {
      refresh(true);
      onOpenChange(false);
      toast.success(`${c.client} renewed`, {
        description: c.owner ? `Until ${date(f.end)}. ${money(+f.value)} counts in ${c.owner.name}'s Revenue KPI.`
          : `Until ${date(f.end)}. No account owner is set, so it doesn't count in anyone's Revenue KPI.`,
      });
    },
    onError: (e) => toast.error("Couldn't record the renewal", { description: errorText(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); if (!bad) save.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{c.client} renewed</DialogTitle>
            <DialogDescription>{c.product}. The next term starts as a new contract, and its renewal opens by itself before it ends.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New term starts" required><DatePicker value={f.start} onChange={(v) => set("start", v ?? "")} /></Field>
              <Field label="New term ends" required><DatePicker value={f.end} onChange={(v) => set("end", v ?? "")} /></Field>
            </div>
            <Field label="Value of the new term (BDT)" required hint={`This term was ${money(+c.value)}.`}>
              <Input type="number" inputMode="numeric" min={0} step={1000} value={f.value} onChange={(e) => set("value", e.target.value)} required />
            </Field>
            <Field label="Renewal terms" hint="Carried over from this term. Change them if they changed.">
              <Input value={f.terms} maxLength={300} onChange={(e) => set("terms", e.target.value)} />
            </Field>
            {isAdmin && (
              <Field label="Client agreed on" hint="The renewal counts in revenue for this day's week. Members can only record today.">
                <DatePicker value={f.on} onChange={(v) => set("on", v ?? today)} />
              </Field>
            )}
            {bad && <p className="text-sm text-danger-text" role="alert">{bad}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!!bad}><CheckCircle2 /> Record renewal</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- the client isn't renewing ----------

function LoseDialog({ r, open, onOpenChange }: { r: Renewal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => (await api.post<Renewal>(`/renewals/opportunities/${r.id}/lose/`, { reason: reason.trim() })).data,
    onSuccess: () => {
      refresh();
      onOpenChange(false);
      toast.success(`${r.contract.client} marked as not renewing`, { description: "The reason helps the team see why clients leave." });
    },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{r.contract.client} isn't renewing</DialogTitle>
            <DialogDescription>{r.contract.product}. Say why, so the team can learn from it. An admin can reopen it later.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Why not?" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} rows={3} required />
            </Field>
            <div className="flex flex-wrap gap-2" aria-label="Common reasons">
              {REASONS.map((x) => (
                <button key={x} type="button" onClick={() => setReason(x)} aria-pressed={reason === x}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary-text">
                  {x}
                </button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="danger" busy={save.isPending} disabled={reason.trim().length < 3}><XCircle /> Not renewing</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- the panel ----------

function Body({ r, lastWindow }: { r: Renewal; lastWindow: number }) {
  const { user } = useAuth();
  const refresh = useRefresh();
  const c = r.contract;
  const isOpen = r.due !== null;
  const editable = isOpen && r.can_edit;
  const init = { stage: (isOpen ? r.stage : "open") as OpenStage, next_action: r.next_action, next_action_on: r.next_action_on,
    value: String(Math.round(+r.value)), upsell: r.upsell };
  const [f, setF] = useState(init);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const missing = !f.next_action.trim() || !f.next_action_on;
  const [dialog, setDialog] = useState<"renew" | "lose" | "reopen" | null>(null);

  const save = useMutation({
    mutationFn: async () => (await api.patch<Renewal>(`/renewals/opportunities/${r.id}/`, { ...f, next_action: f.next_action.trim(), upsell: f.upsell.trim() })).data,
    onSuccess: () => { refresh(); toast.success("Renewal saved"); },
    onError: (e) => toast.error("Couldn't save the renewal", { description: errorText(e) }),
  });
  const reopen = async () => {
    try {
      await api.post(`/renewals/opportunities/${r.id}/reopen/`);
      refresh(true);
      toast.success("Renewal reopened", { description: "It's back on the owner's to-do list." });
    } catch (e) {
      toast.error("Couldn't reopen it", { description: errorText(e) });
      throw e;
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{c.client}</SheetTitle>
        <SheetDescription>{c.product} · {c.kind_label}</SheetDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={STAGE_TONE[r.stage]}>{r.stage_label}</Badge>
          {isOpen && <Badge tone={urgency(r.days_left, lastWindow)}>{endsText(r.days_left)}</Badge>}
        </div>
      </SheetHeader>
      <SheetBody className="space-y-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Fact label="Ends">{date(c.end_date)}</Fact>
          <Fact label="This term's value">{money(+c.value)}</Fact>
          <Fact label="Term">{date(c.start_date, "short")} – {date(c.end_date)}</Fact>
          <Fact label="Account owner">
            {c.owner ? <span className="inline-flex items-center gap-2"><Avatar name={c.owner.name} src={c.owner.photo} size="xs" />{c.owner.name}</span>
              : <span className="text-muted-foreground">Nobody yet</span>}
          </Fact>
          <Fact label="Renewal terms" wide>{c.terms || <span className="text-muted-foreground">Not written down</span>}</Fact>
          {c.notes && <Fact label="Notes" wide><span className="whitespace-pre-line">{c.notes}</span></Fact>}
        </dl>
        <p className="text-xs text-muted-foreground">Renewal opened {date(r.opened_on)}. Reminders bring it back to the owner's to-do list as the end date gets closer.</p>

        {editable && (
          <form id="renewal-form" className="space-y-4 border-t border-border pt-5" onSubmit={(e) => { e.preventDefault(); if (!missing) save.mutate(); }}>
            <Field label="Stage">
              <SimpleSelect value={f.stage} onValueChange={(v) => set("stage", v as OpenStage)} options={OPEN_STAGES.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Field label="Next step" required error={!f.next_action.trim() ? "Every open renewal needs a next step." : undefined}>
                <Input value={f.next_action} maxLength={200} onChange={(e) => set("next_action", e.target.value)} placeholder="e.g. Send the renewal quote" />
              </Field>
              <Field label="By" required><DatePicker value={f.next_action_on} onChange={(v) => set("next_action_on", v)} /></Field>
            </div>
            <Field label="Expected renewal value (BDT)">
              <Input type="number" inputMode="numeric" min={0} step={1000} value={f.value} onChange={(e) => set("value", e.target.value)} />
            </Field>
            <Field label="Upsell idea" hint="An upgrade or extra modules to offer with the renewal.">
              <Input value={f.upsell} maxLength={300} onChange={(e) => set("upsell", e.target.value)} placeholder="e.g. Add the HR module" />
            </Field>
          </form>
        )}

        {isOpen && !editable && (
          <div className="border-t border-border pt-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Fact label="Next step" wide>{r.next_action || "—"}{r.next_action_on && <span className="text-muted-foreground"> · by {date(r.next_action_on)}</span>}</Fact>
              <Fact label="Expected value">{money(+r.value)}</Fact>
              <Fact label="Upsell idea">{r.upsell || "—"}</Fact>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">Only the account owner or an admin can change this renewal.</p>
          </div>
        )}

        {!isOpen && (
          <div className={r.stage === "won" ? "rounded-lg bg-success-soft p-4 text-sm text-success-text" : "rounded-lg bg-muted p-4 text-sm"}>
            {r.stage === "won" ? (
              <>
                <p className="font-semibold">Renewed on {date(r.closed_on)}{r.closed_by && ` · recorded by ${r.closed_by}`}</p>
                <p className="mt-1">New term worth {money(+r.value)}. {r.credit_to ? `It counts in ${r.credit_to}'s Revenue KPI.` : "It had no account owner, so it doesn't count in anyone's Revenue KPI."}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-foreground">Not renewing · {r.lost_reason}</p>
                <p className="mt-1 text-muted-foreground">Recorded {date(r.closed_on)}{r.closed_by && ` by ${r.closed_by}`}.</p>
              </>
            )}
          </div>
        )}
      </SheetBody>

      {editable && (
        <SheetFooter className="flex-wrap justify-between">
          <Button type="button" variant="danger-ghost" onClick={() => setDialog("lose")}><XCircle /> Not renewing</Button>
          <div className="flex gap-2">
            <Button type="submit" form="renewal-form" variant="secondary" busy={save.isPending} disabled={!dirty || missing}>Save</Button>
            <Button type="button" onClick={() => setDialog("renew")}><CheckCircle2 /> Renewed…</Button>
          </div>
        </SheetFooter>
      )}
      {!isOpen && user?.role === "admin" && (
        <SheetFooter><Button type="button" variant="secondary" onClick={() => setDialog("reopen")}><RotateCcw /> Reopen</Button></SheetFooter>
      )}

      <RenewDialog key={`renew-${r.updated_at}`} r={r} open={dialog === "renew"} onOpenChange={(o) => setDialog(o ? "renew" : null)} />
      <LoseDialog key={`lose-${r.updated_at}`} r={r} open={dialog === "lose"} onOpenChange={(o) => setDialog(o ? "lose" : null)} />
      <ConfirmDialog open={dialog === "reopen"} onOpenChange={(o) => setDialog(o ? "reopen" : null)} tone="primary" confirmLabel="Reopen"
        title="Reopen this renewal?" onConfirm={reopen}
        description={r.stage === "won" ? "Use this if it was recorded by mistake. The next term it started is removed, and its revenue stops counting."
          : "Use this if it was recorded by mistake. It goes back on the owner's to-do list."} />
    </>
  );
}

export function RenewalSheet({ id, lastWindow, onClose }: { id: number | null; lastWindow: number; onClose: () => void }) {
  const q = useQuery({
    queryKey: [...KEY, "opportunity", id],
    queryFn: async () => (await api.get<Renewal>(`/renewals/opportunities/${id}/`)).data,
    enabled: id != null,
  });
  return (
    <Sheet open={id != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="sm:max-w-lg">
        {q.data ? <Body key={q.data.updated_at} r={q.data} lastWindow={lastWindow} /> : (
          <>
            <SheetHeader><SheetTitle>Renewal</SheetTitle><SheetDescription>Loading the contract…</SheetDescription></SheetHeader>
            <SheetBody>
              {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
                <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-20 w-full" /><Skeleton className="h-32 w-full" /></div>
              )}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
