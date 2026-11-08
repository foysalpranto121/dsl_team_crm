import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CalendarOff, Flame, Target, X } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recognitionQuery, type RecognitionMe, type Streak } from "./api";

function Count({ icon: Icon, s, one, many, empty }: { icon: typeof Flame; s: Streak; one: string; many: string; empty: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text"><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0">
        {s.current > 0 ? <div className="text-sm font-semibold"><span className="tabular-nums">{s.current}</span> {s.current === 1 ? one : many} in a row</div> : <div className="text-sm">{empty}</div>}
        {s.best > 0 && <div className="text-xs text-muted-foreground">Your best: <span className="tabular-nums">{s.best}</span></div>}
      </div>
    </div>
  );
}

/** FR-MO2: leave and holidays never break a streak. */
function LeaveDialog({ open, onClose, d }: { open: boolean; onClose: () => void; d: RecognitionMe }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ day: null as string | null, reason: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["recognition"] });
  const add = useMutation({
    mutationFn: async () => api.post("/recognition/leave/", f),
    onSuccess: () => { refresh(); setF({ day: null, reason: "" }); toast.success("Marked as a day off"); },
  });
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/recognition/leave/${id}/`), onSuccess: refresh, onError: (e) => toast.error("Couldn't remove it", { description: errorText(e) }) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <DialogHeader><DialogTitle>Days off</DialogTitle><DialogDescription>Leave and holidays never break a streak.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <Field label="Day" required><DatePicker value={f.day} onChange={(v) => setF({ ...f, day: v })} aria-label={f.day ? `Day off: ${date(f.day, "medium")}` : "Choose the day off"} /></Field>
              <Field label="Reason"><Input value={f.reason} maxLength={120} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Optional" /></Field>
            </div>
            {add.error && <p className="text-sm text-danger-text" role="alert">{errorText(add.error)}</p>}
            {d.leave.length > 0 && <ul className="space-y-1 text-sm">{d.leave.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2"><span>{date(l.day, "medium")}{l.reason ? <span className="text-muted-foreground"> · {l.reason}</span> : ""}</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${date(l.day, "medium")}`} onClick={() => remove.mutate(l.id)}><X /></Button></li>))}</ul>}
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Close</Button><Button type="submit" busy={add.isPending} disabled={!f.day}>Add day off</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** My Progress: streaks and the five badges (SRS v0.5 FR-MO2, FR-MO3). They never change a score. */
export function StreaksCard({ work }: { work: string | null }) {
  const q = useQuery(recognitionQuery(work));
  const [leave, setLeave] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40" />;
  const d = q.data;
  if (!d || (!d.streaks && !d.badges)) return null;
  const earned = d.badges?.filter((b) => b.earned_on).length ?? 0;
  return (
    <section className="card p-4" aria-labelledby="streaks-title">
      <h2 id="streaks-title" className="text-sm font-semibold">Streaks and badges</h2>
      {d.streaks && <div className="mt-3 space-y-3">
        <Count icon={Flame} s={d.streaks.days} one="day closed on time" many="days closed on time" empty="Close today to start a streak." />
        <Count icon={Target} s={d.streaks.weeks} one="week on target" many="weeks on target" empty="Hit this week's hours to start a streak." />
        {d.mine && <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setLeave(true)}><CalendarOff /> Days off{d.leave.length ? ` · ${d.leave.length}` : ""}</Button>}
      </div>}
      {d.badges && <div className={cn(d.streaks && "mt-3 border-t border-border pt-3")}>
        <h3 className="text-xs font-semibold text-muted-foreground">Badges <span className="font-normal tabular-nums">· {earned} of {d.badges.length}</span></h3>
        <ul className="mt-2 space-y-2">{d.badges.map((b) => (
          <li key={b.key} className="flex items-start gap-2">
            <Award className={cn("mt-0.5 size-4 shrink-0", b.earned_on ? "text-accent-text" : "text-subtle-foreground")} aria-hidden />
            <div className="min-w-0"><div className={cn("text-sm", b.earned_on ? "font-medium" : "text-muted-foreground")}>{b.name}</div>
              <div className="text-xs text-muted-foreground">{b.earned_on ? `Earned ${date(b.earned_on, "short")}` : b.why}</div></div>
          </li>))}</ul>
      </div>}
      {d.mine && <LeaveDialog open={leave} onClose={() => setLeave(false)} d={d} />}
    </section>
  );
}
