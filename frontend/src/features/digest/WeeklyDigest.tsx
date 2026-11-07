import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Copy, History, Mail, Send, Users } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import { ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, relative } from "@/lib/format";

/** Admin → Weekly digest (SRS v0.3 §14.9, FR-TM4): the management email exactly as it goes out, sending and the weekly schedule. */

interface Sent { week_start: string; at: string; recipients: string[]; by: string | null }
interface DigestResponse {
  week_start: string;
  latest_week: string;
  subject: string;
  html: string;
  recipients: string[];
  sent: Sent | null;
  history: Sent[];
  automatic: boolean;
  data: { week: { start: string; end: string; no: number } };
}

const shiftWeek = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 7 * n));
  return t.toISOString().slice(0, 10);
};

function Preview({ html, subject }: { html: string; subject: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Mail className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="truncate text-sm font-semibold">{subject}</p>
        </div>
      </div>
      <iframe ref={frame} title="Email preview" srcDoc={html} sandbox="allow-same-origin allow-popups" className="block w-full bg-[#f5f6f8]" style={{ height }}
        onLoad={() => { const doc = frame.current?.contentDocument; if (doc) setHeight(doc.documentElement.scrollHeight + 8); }} />
    </section>
  );
}

function Schedule({ on }: { on: boolean }) {
  const url = `${window.location.origin}/api/ops/digest/run/`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("Address copied"); } catch { toast.error("Couldn't copy — select it by hand."); }
  };
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Send it every week</h2>
        <StatusPill status={on ? "good" : "neutral"}>{on ? "Turned on" : "Off"}</StatusPill>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {on ? "The server is ready. A weekly job on cron-job.org sends last week's digest; it never sends the same week twice."
          : "Admins can send it from here any time. To send it automatically every week:"}
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        {!on && <li>On Render → the API → <b className="text-foreground">Environment</b>, add <Kbd>DIGEST_CRON_SECRET</Kbd> with a long random value.</li>}
        <li>On <b className="text-foreground">cron-job.org</b>, create a job: method <Kbd>POST</Kbd>, every Saturday at 9:00 (Asia/Dhaka), address:
          <span className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs text-foreground">{url}</code>
            <Button size="icon-sm" variant="ghost" onClick={copy} aria-label="Copy the address"><Copy /></Button>
          </span>
        </li>
        <li>Under <b className="text-foreground">Advanced → Headers</b>, add <Kbd>X-Cron-Secret</Kbd> with the same value.</li>
      </ol>
    </section>
  );
}

export default function WeeklyDigest() {
  const qc = useQueryClient();
  const [week, setWeek] = useState<string | null>(null);   // null = last finished week
  const q = useQuery({
    queryKey: ["digest", week],
    queryFn: async () => (await api.get<DigestResponse>("/ops/digest/", { params: { week: week ?? undefined } })).data,
    placeholderData: (prev) => prev,
  });
  const [confirm, setConfirm] = useState(false);
  const send = useMutation({
    mutationFn: async (force: boolean) => (await api.post<{ sent: Sent }>("/ops/digest/send/", { week: q.data?.week_start, force })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["digest"] });
      toast.success("Digest sent", { description: `To ${r.sent.recipients.length} ${r.sent.recipients.length === 1 ? "person" : "people"}.` });
    },
    onError: (e) => toast.error("Couldn't send the digest", { description: errorText(e) }),
  });

  if (q.isLoading) return <PageSkeleton stats={0} charts={1} rows={0} />;
  if (q.isError || !q.data) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const d = q.data;
  const w = d.data.week;
  const isLatest = d.week_start >= d.latest_week;

  return (
    <>
      <PageHeader title="Weekly digest" subtitle="One email a week for admins and management: scorecards, funnel, forecast, wins and risks."
        actions={<Button onClick={() => (d.sent ? setConfirm(true) : send.mutate(false))} busy={send.isPending}><Send /> {d.sent ? "Send again" : "Send now"}</Button>} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon-sm" aria-label="Previous week" onClick={() => setWeek(shiftWeek(d.week_start, -1))}><ChevronLeft /></Button>
        <span className="min-w-48 text-center text-sm font-semibold">Week {w.no} · {date(w.start, "short")} – {date(w.end, "short")}</span>
        <Button variant="secondary" size="icon-sm" aria-label="Next week" disabled={isLatest} onClick={() => setWeek(isLatest ? null : shiftWeek(d.week_start, 1))}><ChevronRight /></Button>
        {isLatest ? <Badge tone="primary">Last week</Badge> : <Button variant="ghost" size="sm" onClick={() => setWeek(null)}>Back to last week</Button>}
        {q.isFetching && <Skeleton className="h-4 w-16" />}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Preview html={d.html} subject={d.subject} />
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-muted-foreground" aria-hidden /> This week's digest</h2>
            {d.sent ? (
              <p className="mt-2 text-sm text-muted-foreground"><StatusPill status="good">Sent</StatusPill> {relative(d.sent.at)} to {d.sent.recipients.length} {d.sent.recipients.length === 1 ? "person" : "people"}{d.sent.by ? ` by ${d.sent.by}` : " automatically"}.</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground"><StatusPill status="neutral">Not sent yet</StatusPill></p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-muted-foreground" aria-hidden /> Who gets it</h2>
            {d.recipients.length ? (
              <ul className="mt-3 space-y-1.5 text-sm">{d.recipients.map((r) => <li key={r} className="truncate">{r}</li>)}</ul>
            ) : <p className="mt-2 text-sm text-danger-text">Nobody yet — approve an admin or management account with an email address.</p>}
            <p className="mt-3 text-xs text-muted-foreground">Every approved admin and management account. Add others with <Kbd>DIGEST_EXTRA_RECIPIENTS</Kbd> on the server.</p>
          </section>

          <Schedule on={d.automatic} />

          {d.history.length > 0 && (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-muted-foreground" aria-hidden /> Sent before</h2>
              <ul className="mt-3 divide-y divide-border text-sm">
                {d.history.map((h) => (
                  <li key={h.week_start} className="flex items-center justify-between gap-3 py-2">
                    <button type="button" className="text-left font-medium text-primary-text hover:underline" onClick={() => setWeek(h.week_start)}>Week of {date(h.week_start, "short")}</button>
                    <span className="text-xs text-muted-foreground">{h.by ? h.by : "automatic"} · {relative(h.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="primary" confirmLabel="Send again"
        title={`Send week ${w.no}'s digest again?`}
        description={d.sent ? `It already went to ${d.sent.recipients.length} ${d.sent.recipients.length === 1 ? "person" : "people"} ${relative(d.sent.at)}.` : undefined}
        onConfirm={() => send.mutateAsync(true)} />
    </>
  );
}
