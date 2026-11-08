import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Choice, RadioGroup, RadioGroupItem } from "@/components/ui/form-controls";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { addDays } from "../log/util";
import { defaultFramework, missingFor, refreshPipeline, type PipelineConfig, type PipelineRecord, type Stage } from "./api";

/** The API's per-field messages ({"value": ["…"]}) as {value: "…"}. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!axios.isAxiosError(e) || !e.response?.data || typeof e.response.data !== "object") return {};
  return Object.fromEntries(Object.entries(e.response.data as Record<string, unknown>).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v)]));
}

/** "Moved to Negotiation" — and a word about review when it went backwards (SRS v0.5 FR-K2). */
export function movedToast(r: PipelineRecord, from: Stage | undefined, to: Stage) {
  if (from && from.kind !== "lost" && to.kind !== "lost" && (to.kind === "open" && from.kind !== "open" || to.kind === from.kind && to.position < from.position)) {
    toast.warning(`${r.company} moved back to ${to.name}`, { description: "Moving back is flagged for your supervisor to review. It doesn't count twice." });
  } else if (to.kind === "won") {
    toast.success(`${r.company} won`, { description: "It counts as a client once your supervisor verifies the work order." });
  } else toast.success(`${r.company} moved to ${to.name}`);
}

const money = (currency: string) => `Expected value (${currency})`;

/** Moving a record to a stage that needs more: an expected value, the next step, a win/loss note or a lost reason. */
export function MoveDialog({ record, to, from, config, onClose }: {
  record: PipelineRecord | null; to: Stage | null; from?: Stage; config: PipelineConfig; onClose: () => void;
}) {
  const qc = useQueryClient();
  const need = record && to ? missingFor(to, record, config) : [];
  const blank = { value: "", next_action: "", next_follow_up: null as string | null, win_loss_why: "", win_loss_competitor: "", win_loss_lesson: "", lost_reason: "",
    old_steps: "keep" as "keep" | "drop" };
  const [f, setF] = useState(blank);
  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { stage: to!.key };
      if (need.includes("value")) body.value = f.value;
      if (need.includes("next")) Object.assign(body, { next_action: f.next_action, next_follow_up: f.next_follow_up });
      if (need.includes("why")) Object.assign(body, { win_loss_why: f.win_loss_why, win_loss_competitor: f.win_loss_competitor, win_loss_lesson: f.win_loss_lesson });
      if (need.includes("lost_reason")) body.lost_reason = f.lost_reason;
      if (need.includes("old_steps")) body.old_steps = f.old_steps;
      return (await api.patch<PipelineRecord>(`/tracker/prospects/${record!.id}/`, body)).data;
    },
    onSuccess: (r) => { refreshPipeline(qc); movedToast(r, from, to!); close(); },
  });
  const err = fieldErrors(save.error);
  const close = () => { onClose(); save.reset(); setF(blank); };
  if (!record || !to) return null;
  const won = to.kind === "won", lost = to.kind === "lost";
  const nextFw = defaultFramework(config, to.key, record.segment);
  const left = (record.framework?.open ?? 0) + (record.framework?.waiting ?? 0);
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{won ? `Mark ${record.company} as won` : lost ? `Mark ${record.company} as lost` : `Move ${record.company} to ${to.name}`}</DialogTitle>
            <DialogDescription>{won ? "A short note helps the team learn from it (SRS FR-K11)." : lost ? "Why it was lost feeds the team's lost-reason report."
              : to.exit_criteria ? `To be here: ${to.exit_criteria}.` : "A couple of details first."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {nextFw && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{to.name} gives it the “{nextFw.name}” framework: {nextFw.steps} dated {nextFw.steps === 1 ? "step" : "steps"} from today.</p>}
            {need.includes("old_steps") && <fieldset>
              <legend className="label mb-1.5">{left} unfinished {left === 1 ? "step" : "steps"}{record.framework?.framework ? ` from “${record.framework.framework}”` : ""}</legend>
              <RadioGroup value={f.old_steps} onValueChange={(v) => setF({ ...f, old_steps: v as "keep" | "drop" })}>
                <Choice control={<RadioGroupItem value="keep" />} label="Keep them on my list" description="They stay open with their dates." />
                <Choice control={<RadioGroupItem value="drop" />} label="Drop them" description="They close, and the drop is noted in the Client Log." />
              </RadioGroup>
            </fieldset>}
            {need.includes("value") && <Field label={money(config.currency)} required error={err.value} hint={`${to.name} needs an expected value.`}>
              <Input type="number" min={0} step="any" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></Field>}
            {need.includes("next") && <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label="Next step" required error={err.next_action}><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} placeholder="e.g. Send the proposal" required /></Field>
              <Field label="When" required error={err.next_follow_up}><DatePicker value={f.next_follow_up} onChange={(v) => setF({ ...f, next_follow_up: v })} aria-label="Next step date" /></Field>
            </div>}
            {need.includes("lost_reason") && <Field label="Lost reason" required error={err.lost_reason}>
              <SimpleSelect value={f.lost_reason} onValueChange={(v) => setF({ ...f, lost_reason: v })} placeholder="Choose a reason" aria-label="Lost reason"
                options={config.lost_reasons.map((x) => ({ value: x, label: x }))} /></Field>}
            {need.includes("why") && <>
              <Field label={won ? "Why we won" : "Why we lost"} required error={err.win_loss_why}>
                <Textarea value={f.win_loss_why} maxLength={300} className="min-h-16" onChange={(e) => setF({ ...f, win_loss_why: e.target.value })} required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Competitor"><Input value={f.win_loss_competitor} maxLength={120} onChange={(e) => setF({ ...f, win_loss_competitor: e.target.value })} placeholder="If there was one" /></Field>
                <Field label="Lesson"><Input value={f.win_loss_lesson} maxLength={300} onChange={(e) => setF({ ...f, win_loss_lesson: e.target.value })} placeholder="One thing to repeat or avoid" /></Field>
              </div>
            </>}
            {save.error && !Object.keys(err).some((k) => ["value", "next_action", "next_follow_up", "lost_reason", "win_loss_why"].includes(k)) &&
              <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={need.includes("next") && !f.next_follow_up}>{won ? "Mark as won" : lost ? "Mark as lost" : `Move to ${to.name}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Quick add (SRS v0.5 FR-K1, about 15 seconds): who, what they need, where it stands, and the next step. */
export function AddRecordDialog({ open, onOpenChange, config, onAdded }: {
  open: boolean; onOpenChange: (o: boolean) => void; config: PipelineConfig; onAdded?: (r: PipelineRecord) => void;
}) {
  const qc = useQueryClient();
  const today = useQuery(todayQuery).data?.today;
  const openStages = config.stages.filter((s) => s.active && s.kind === "open").sort((a, b) => a.position - b.position);
  const blank = () => ({ company: "", requirement: "", stage: openStages[0]?.key ?? "", next_action: "", next_follow_up: today ? addDays(today, 1) : null as string | null, value: "", channel: "" });
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(blank()); }, [open, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stage = openStages.find((s) => s.key === f.stage);
  const fw = defaultFramework(config, f.stage);
  const save = useMutation({
    mutationFn: async () => {
      const { next_action, next_follow_up, ...rest } = f;
      return (await api.post<PipelineRecord>("/tracker/prospects/", { ...rest, ...(fw ? {} : { next_action, next_follow_up }), value: f.value === "" ? null : f.value })).data;
    },
    onSuccess: (r) => { refreshPipeline(qc); toast.success(`${r.company} added`, { description: `At ${r.stage_name}. Next: ${r.next_action}.` }); onOpenChange(false); setF(blank()); onAdded?.(r); },
  });
  const err = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) save.reset(); }}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader><DialogTitle>Add a pipeline record</DialogTitle>
            <DialogDescription>A qualified lead or an opportunity. Weekly KPIs are counted from where it goes next.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client or organisation" required error={err.company}><Input value={f.company} maxLength={200} onChange={(e) => setF({ ...f, company: e.target.value })} required autoFocus /></Field>
              <Field label="Stage" required error={err.stage}><SimpleSelect value={f.stage} onValueChange={(v) => setF({ ...f, stage: v })} aria-label="Stage"
                options={openStages.map((s) => ({ value: s.key, label: s.name }))} /></Field>
            </div>
            <Field label="Requirement" required error={err.requirement}><Input value={f.requirement} maxLength={300} onChange={(e) => setF({ ...f, requirement: e.target.value })} placeholder="e.g. HR software for 300 staff" required /></Field>
            {fw ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">Next steps come from the “{fw.name}” framework: {fw.steps} dated {fw.steps === 1 ? "step" : "steps"} from today.</p>
              : <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <Field label="Next step" required error={err.next_action}><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} placeholder="e.g. Book a discovery call" required /></Field>
                <Field label="When" required error={err.next_follow_up}><DatePicker value={f.next_follow_up} onChange={(v) => setF({ ...f, next_follow_up: v })} aria-label="Next step date" /></Field>
              </div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={money(config.currency)} required={stage?.value_required} error={err.value} hint={stage?.value_required ? undefined : "Optional until the proposal."}>
                <Input type="number" min={0} step="any" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required={stage?.value_required} /></Field>
              <Field label="Lead source" error={err.channel}><Input value={f.channel} maxLength={60} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="Referral, LinkedIn, tender portal…" /></Field>
            </div>
            {save.error && !Object.keys(err).length && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!fw && !f.next_follow_up}>Add record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
