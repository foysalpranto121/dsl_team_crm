import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, ArrowRightLeft, BadgeCheck, CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone, StickyNote, Trash2, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import { Timeline } from "@/components/data/steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { date, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { logQuery, orderedStages, refreshPipeline, type Health, type PipelineConfig, type PipelineRecord, type Stage } from "./api";
import { NextStepCard, StepsPanel } from "../frameworks/StepsPanel";
import { fieldErrors } from "./dialogs";

const LOG_ICON: Record<string, ReactNode> = { call: <Phone />, email: <Mail />, whatsapp: <MessageCircle />, visit: <MapPin />, meeting: <Users />, note: <StickyNote />,
  stage: <ArrowRightLeft /> };
const HEALTH: Record<Health["state"], { Icon: typeof CheckCircle2; cls: string }> = {
  good: { Icon: CheckCircle2, cls: "border-success/30 bg-success-soft text-success-text" },
  warning: { Icon: AlertTriangle, cls: "border-warning/30 bg-warning-soft text-warning-text" },
  danger: { Icon: AlertCircle, cls: "border-danger/30 bg-danger-soft text-danger-text" },
};

/** The record's stages, open ones in order then Won and Lost. Click one to move the record there. */
function StageStepper({ record, stages, onMove }: { record: PipelineRecord; stages: Stage[]; onMove: (s: Stage) => void }) {
  const current = stages.find((s) => s.key === record.stage);
  return (
    <div role="group" aria-label="Move to stage" className="-mx-1 flex flex-wrap gap-1.5">
      {stages.map((s) => {
        const here = s.key === record.stage;
        const passed = !here && current && s.kind === "open" && current.kind !== "lost" && (current.kind === "won" || s.position < current.position);
        return (
          <button key={s.key} type="button" aria-current={here ? "step" : undefined} onClick={() => !here && onMove(s)}
            className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
              here ? (s.kind === "won" ? "border-success bg-success text-white" : s.kind === "lost" ? "border-danger bg-danger text-white" : "border-primary bg-primary text-primary-foreground")
                : passed ? "border-success/40 bg-success-soft text-success-text hover:border-success"
                  : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground")}>
            {passed && <CheckCircle2 className="size-3" aria-hidden />}{s.name}
          </button>
        );
      })}
    </div>
  );
}

function ClientLog({ record, config }: { record: PipelineRecord; config: PipelineConfig }) {
  const qc = useQueryClient();
  const log = useQuery(logQuery(record.id));
  const blank = { type: "call", outcome: "", note: "", next_date: null as string | null, next_action: "" };
  const [f, setF] = useState(blank);
  const add = useMutation({
    mutationFn: async () => (await api.post(`/tracker/prospects/${record.id}/log/`, f)).data,
    onSuccess: () => { refreshPipeline(qc); setF(blank); toast.success("Logged", { description: f.next_date ? `Next step set for ${date(f.next_date, "short")}.` : undefined }); },
  });
  const err = fieldErrors(add.error);
  return (
    <div className="space-y-5">
      <form className="rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <Field label="Type"><SimpleSelect value={f.type} onValueChange={(v) => setF({ ...f, type: v })} aria-label="Type" options={config.log_types.map((t) => ({ value: t.key, label: t.label }))} /></Field>
          <Field label="Outcome" error={err.outcome}><Input value={f.outcome} maxLength={120} onChange={(e) => setF({ ...f, outcome: e.target.value })} placeholder="e.g. Asked for a quote" /></Field>
        </div>
        <Field label="Note" className="mt-3"><Textarea value={f.note} maxLength={1000} className="min-h-16" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Next step" hint="Optional: becomes the record's next step."><Input value={f.next_action} maxLength={200} onChange={(e) => setF({ ...f, next_action: e.target.value })} placeholder={record.next_action || "e.g. Send the revised quote"} /></Field>
          <Field label="Next date" error={err.next_date}><DatePicker value={f.next_date} onChange={(v) => setF({ ...f, next_date: v })} placeholder="No change" aria-label="Next date" /></Field>
        </div>
        {add.error && !err.next_date && !err.outcome && <p className="mt-2 text-sm text-danger-text" role="alert">{errorText(add.error)}</p>}
        <div className="mt-3 flex justify-end"><Button type="submit" size="sm" busy={add.isPending} disabled={!f.outcome.trim() && !f.note.trim()}>Log it</Button></div>
      </form>
      {log.isLoading ? <Skeleton className="h-32" /> : !log.data?.length ? <p className="text-sm text-muted-foreground">Nothing logged yet.</p> : (
        <Timeline items={log.data.map((e) => ({
          id: e.id, icon: LOG_ICON[e.type], tone: e.type === "stage" ? "primary" : "neutral",
          title: e.type === "stage" ? e.note : <>{e.type_label}{e.outcome && <span className="font-normal text-muted-foreground"> · {e.outcome}</span>}</>,
          time: date(e.day, "short"),
          description: e.type === "stage" ? (e.by_name ? `by ${e.by_name}` : undefined) : <>
            {e.note && <span className="block whitespace-pre-line">{e.note}</span>}
            {e.next_date && <span className="mt-0.5 inline-flex items-center gap-1 text-xs"><Clock className="size-3" aria-hidden />Next: {date(e.next_date, "short")}</span>}
          </>,
        }))} />
      )}
    </div>
  );
}

type Form = Pick<PipelineRecord, "requirement" | "segment" | "deal_currency" | "odoo_ref" | "channel" | "next_action" | "win_loss_why" | "win_loss_competitor" |
  "win_loss_lesson" | "lost_reason" | "contact" | "role" | "email" | "phone" | "linkedin" | "website" | "country" | "industry" | "notes" | "company"> &
  { value: string; deal_value: string; tender_deadline: string | null; next_follow_up: string | null };
const formOf = (r: PipelineRecord): Form => ({
  company: r.company, requirement: r.requirement, segment: r.segment, value: r.value ?? "", deal_currency: r.deal_currency, deal_value: r.deal_value ?? "",
  tender_deadline: r.tender_deadline, odoo_ref: r.odoo_ref, channel: r.channel, next_action: r.next_action, next_follow_up: r.next_follow_up,
  win_loss_why: r.win_loss_why, win_loss_competitor: r.win_loss_competitor, win_loss_lesson: r.win_loss_lesson, lost_reason: r.lost_reason,
  contact: r.contact, role: r.role, email: r.email, phone: r.phone, linkedin: r.linkedin, website: r.website, country: r.country, industry: r.industry, notes: r.notes,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-3"><legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>{children}</fieldset>;
}

function Details({ record, config, onDeleted }: { record: PipelineRecord; config: PipelineConfig; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => formOf(record));
  useEffect(() => setF(formOf(record)), [record]);
  const [confirm, setConfirm] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(formOf(record));
  const save = useMutation({
    mutationFn: async () => (await api.patch(`/tracker/prospects/${record.id}/`, { ...f, value: f.value === "" ? null : f.value, deal_value: f.deal_value === "" ? null : f.deal_value })).data,
    onSuccess: () => { refreshPipeline(qc); toast.success("Saved"); },
  });
  const err = fieldErrors(save.error);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const text = (k: keyof Form, label: string, o: { required?: boolean; placeholder?: string; type?: string; max?: number } = {}) => (
    <Field label={label} required={o.required} error={err[k]}><Input type={o.type ?? "text"} value={(f[k] as string) ?? ""} maxLength={o.max ?? 200} onChange={set(k)} placeholder={o.placeholder} required={o.required} /></Field>);
  const open = record.stage_kind === "open";
  return (
    <form id="record-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {open && record.framework?.next && <Section title="Next step">
        <p className="text-sm">{record.framework.next.title} <span className="text-muted-foreground">· {date(record.framework.next.due_date, "short")}</span></p>
        <p className="text-xs text-muted-foreground">Set by the {record.framework.framework ? `“${record.framework.framework}”` : "stage's"} framework. Complete, move or drop it under Steps.</p>
      </Section>}
      {open && !record.framework?.next && <Section title="Next step">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          {text("next_action", "What you'll do", { required: true })}
          <Field label="When" required error={err.next_follow_up}><DatePicker value={f.next_follow_up} onChange={(v) => setF({ ...f, next_follow_up: v })} aria-label="Next step date" /></Field>
        </div>
      </Section>}
      {!open && <Section title={record.stage_kind === "won" ? "Why we won" : "Why we lost"}>
        {record.stage_kind === "lost" && <Field label="Lost reason" required error={err.lost_reason}>
          <SimpleSelect value={f.lost_reason} onValueChange={(v) => setF({ ...f, lost_reason: v })} aria-label="Lost reason"
            options={[...new Set([...config.lost_reasons, f.lost_reason].filter(Boolean))].map((x) => ({ value: x, label: x }))} /></Field>}
        <Field label="Why" required error={err.win_loss_why}><Textarea value={f.win_loss_why} maxLength={300} className="min-h-16" onChange={set("win_loss_why")} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">{text("win_loss_competitor", "Competitor", { max: 120 })}{text("win_loss_lesson", "Lesson", { max: 300 })}</div>
      </Section>}
      <Section title="The deal">
        {text("company", "Client or organisation", { required: true })}
        {text("requirement", "Requirement", { required: true, max: 300 })}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Expected value (${config.currency})`} error={err.value} required={config.stages.find((s) => s.key === record.stage)?.value_required}>
            <Input type="number" min={0} step="any" inputMode="decimal" value={f.value} onChange={set("value")} /></Field>
          {text("segment", "Segment or product", { placeholder: "Tender, Corporate, SaaS…", max: 80 })}
          <Field label="Deal currency" hint="Only if priced in another currency." error={err.deal_currency}>
            <Input value={f.deal_currency} maxLength={3} onChange={(e) => setF({ ...f, deal_currency: e.target.value.toUpperCase() })} placeholder="USD" /></Field>
          <Field label="Deal value in that currency" error={err.deal_value}><Input type="number" min={0} step="any" inputMode="decimal" value={f.deal_value} onChange={set("deal_value")} /></Field>
          <Field label="Tender deadline"><DatePicker value={f.tender_deadline} onChange={(v) => setF({ ...f, tender_deadline: v })} placeholder="None" aria-label="Tender deadline" /></Field>
          {text("channel", "Lead source", { max: 60 })}
        </div>
        {text("odoo_ref", "Odoo ID or link", { max: 300 })}
      </Section>
      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          {text("contact", "Name", { max: 150 })}{text("role", "Job title", { max: 150 })}{text("email", "Email", { type: "email" })}{text("phone", "Phone or WhatsApp", { max: 60 })}
          {text("website", "Website")}{text("linkedin", "LinkedIn", { max: 300 })}{text("country", "Country", { max: 80 })}{text("industry", "Industry", { max: 80 })}
        </div>
      </Section>
      <Section title="Notes"><Textarea value={f.notes} maxLength={5000} onChange={set("notes")} aria-label="Notes" /></Section>
      {save.error && !Object.keys(err).length && <p className="text-sm text-danger-text" role="alert">{errorText(save.error)}</p>}
      {/* -bottom-4 cancels the drawer body's bottom padding, so the bar sits flush with the edge */}
      <div className="sticky -bottom-4 -mx-5 flex items-center justify-between gap-2 border-t border-border bg-card px-5 py-3">
        <Button type="button" variant="danger-ghost" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
        <div className="flex gap-2">
          {dirty && <Button type="button" variant="secondary" onClick={() => { setF(formOf(record)); save.reset(); }}>Undo changes</Button>}
          <Button type="submit" busy={save.isPending} disabled={!dirty}>Save</Button>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${record.company}?`} confirmLabel="Delete record"
        description="Its Client Log and stage history go too, and your weekly KPIs are worked out again without it."
        onConfirm={async () => { await api.delete(`/tracker/prospects/${record.id}/`); refreshPipeline(qc); toast.success(`${record.company} deleted`); onDeleted(); }} />
    </form>
  );
}

/** One record: stage stepper, deal health with a suggested fix (FR-K10), details and the Client Log (FR-CL1). */
export function RecordSheet({ record, config, onClose, onMove }: {
  record: PipelineRecord | null; config: PipelineConfig; onClose: () => void; onMove: (r: PipelineRecord, s: Stage) => void;
}) {
  const [tab, setTab] = useState("details");
  useEffect(() => setTab("details"), [record?.id]);
  const stages = orderedStages(config.stages).filter((s) => s.active || s.key === record?.stage);
  const h = record?.health;
  const today = useQuery(todayQuery).data?.today ?? "";
  const steps = (record?.framework?.open ?? 0) + (record?.framework?.waiting ?? 0);
  return (
    <Sheet open={!!record} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        {record && <>
          <SheetHeader className="gap-3">
            <div>
              <SheetTitle>{record.company}</SheetTitle>
              <SheetDescription>{record.requirement || "No requirement written yet"}</SheetDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone={record.stage_kind === "won" ? "success" : record.stage_kind === "lost" ? "danger" : "primary"}>{record.stage_name}</Badge>
              {record.stage_kind === "open" && <Badge tone="outline">{record.probability}% likely</Badge>}
              {record.value != null && <Badge tone="outline">{money(+record.value, { currency: config.currency })}</Badge>}
              {record.stage_kind === "won" && (record.verified ? <Badge tone="success"><BadgeCheck /> Work order verified</Badge>
                : <Badge tone="warning"><Clock /> Waiting for your supervisor to verify</Badge>)}
              {record.days_in_stage != null && record.stage_kind === "open" && <span className="text-muted-foreground">{record.days_in_stage} {record.days_in_stage === 1 ? "day" : "days"} in this stage</span>}
            </div>
            <StageStepper record={record} stages={stages} onMove={(s) => onMove(record, s)} />
          </SheetHeader>
          <SheetBody className="space-y-5">
            {h && h.state !== "good" && (() => { const H = HEALTH[h.state]; return (
              <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", H.cls)} role="status">
                <H.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div><div className="font-medium">{h.label}</div>{h.fix && <div className="text-foreground/80">{h.fix}</div>}</div>
              </div>); })()}
            <NextStepCard recordId={record.id} open={record.stage_kind === "open"} today={today} onShowAll={() => setTab("steps")} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="steps">Steps{steps ? ` · ${steps}` : ""}</TabsTrigger><TabsTrigger value="log">Client Log</TabsTrigger></TabsList>
              <TabsContent value="details" className="pt-4"><Details record={record} config={config} onDeleted={onClose} /></TabsContent>
              <TabsContent value="steps" className="pt-4"><StepsPanel recordId={record.id} open={record.stage_kind === "open"} today={today} /></TabsContent>
              <TabsContent value="log" className="pt-4"><ClientLog record={record} config={config} /></TabsContent>
            </Tabs>
          </SheetBody>
        </>}
      </SheetContent>
    </Sheet>
  );
}
