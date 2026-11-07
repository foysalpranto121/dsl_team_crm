import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Megaphone, Presentation, ShieldCheck, Sunrise,
  Target, Timer, Trophy, X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, errorText } from "@/api/client";
import { Avatar } from "@/components/Brand";
import { ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Progress, ProgressRing } from "@/components/ui/progress";
import { PageSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Morning huddle (SRS v0.3 §14.9, FR-TM1): ten minutes, four things — yesterday, today's plan, what needs attention,
 * and one focus for today. "Start huddle" shows one section at a time, full screen, with a 10-minute timer.
 */

interface Win { id: string; day: string; what: string; person: string; photo: string | null; details: string | null }
interface StuckDeal { id: number; company: string; stage: string; owner: string; reason: string; days: number; next_action: string }
interface HuddleData {
  team: string;
  today: string;
  week_no: number;
  yesterday: { day: string; people: number; logged: number; target_hours: number; hours: number; points: number;
    shout_out: { person: string; photo: string | null; hours: number; points: number } | null };
  wins: { configured: boolean; items: Win[] };
  plan: { people: number; planned: number; hours: number; target_hours: number; workday: boolean; by_type: { type: string; hours: number }[] };
  attention: { missing_results: { person: string; weeks: number }[]; pending_people: number | null;
    stuck: { items: StuckDeal[]; total: number; shared_pipelines: number } | null };
  focus: { suggested: { metric: string | null; text: string }; current: { text: string; by: string | null; at: string } | null; can_set: boolean };
}

const KEY = ["huddle"];

function Section({ icon, eyebrow, title, children, className }: { icon: ReactNode; eyebrow?: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card flex flex-col p-5 sm:p-6", className)}>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text [&>svg]:size-5" aria-hidden>{icon}</span>
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>}
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function Yesterday({ h }: { h: HuddleData }) {
  const y = h.yesterday;
  return (
    <Section icon={<Sunrise />} eyebrow={date(y.day, "weekday")} title="Yesterday">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Team hours</p>
          <p className="mt-1 text-2xl font-semibold">{num(y.hours)} <span className="text-sm font-normal text-muted-foreground">of {num(y.target_hours)}</span></p>
          <Progress value={y.hours} max={y.target_hours} size="sm" tone={y.target_hours && y.hours >= y.target_hours ? "success" : "primary"} label="Team hours yesterday" className="mt-2" />
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Points</p>
          <p className="mt-1 text-2xl font-semibold">{num(y.points)}</p>
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Logged their day</p>
          <p className="mt-1 text-2xl font-semibold">{y.logged} <span className="text-sm font-normal text-muted-foreground">of {y.people}</span></p>
        </div>
      </div>
      {y.shout_out && (
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-warning-soft px-4 py-3">
          <Avatar name={y.shout_out.person} src={y.shout_out.photo} size="md" />
          <p className="text-sm text-warning-text">
            <span className="font-semibold">Shout-out: {y.shout_out.person}</span> — {num(y.shout_out.points)} points in {num(y.shout_out.hours)} hours, top of the day.
          </p>
        </div>
      )}
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wins since yesterday</h3>
      {!h.wins.configured ? (
        <p className="text-sm text-muted-foreground">No task counts as a win yet. An admin can choose one in Admin → TV screens.</p>
      ) : h.wins.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wins logged since yesterday. The next work order gets celebrated here.</p>
      ) : (
        <ul className="space-y-2">
          {h.wins.items.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <Trophy className="size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{w.person}</span> · {w.what}
                {w.details && <span className="block truncate text-xs text-muted-foreground">{w.details}</span>}
              </div>
              <span className="text-xs text-muted-foreground">{w.day === h.today ? "Today" : date(w.day, "short")}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TodaysPlan({ h }: { h: HuddleData }) {
  const p = h.plan;
  const max = Math.max(1, ...p.by_type.map((t) => t.hours));
  return (
    <Section icon={<ClipboardList />} eyebrow={date(h.today, "weekday")} title="Today's plan">
      {!p.workday ? (
        <p className="text-sm text-muted-foreground">Today isn't a working day.</p>
      ) : (
        <>
          <div className="flex items-center gap-5">
            <ProgressRing value={p.planned} max={Math.max(1, p.people)} size={88} stroke={8} tone={p.people && p.planned >= p.people ? "success" : "primary"}
              label={`${p.planned} of ${p.people} people have a plan for today`}>
              <span className="text-lg font-semibold">{p.people ? pct(p.planned / p.people) : "—"}</span>
            </ProgressRing>
            <div>
              <p className="text-sm"><span className="text-2xl font-semibold">{p.planned}</span> of {p.people} people have planned today</p>
              <p className="mt-1 text-sm text-muted-foreground">{num(p.hours)} hours planned · the team target is about {num(p.target_hours)} a day</p>
            </div>
          </div>
          <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned work by kind</h3>
          {p.by_type.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans for today yet. Plans entered on plan sheets for today show here.</p>
          ) : (
            <ul className="space-y-2.5">
              {p.by_type.map((t) => (
                <li key={t.type} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-foreground">{t.type}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-primary-soft" aria-hidden>
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(t.hours / max) * 100}%` }} />
                  </span>
                  <span className="num text-xs text-muted-foreground">{t.hours} h</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function Attention({ h }: { h: HuddleData }) {
  const a = h.attention;
  const nothing = !a.pending_people && a.missing_results.length === 0 && !(a.stuck && a.stuck.total);
  return (
    <Section icon={<AlertTriangle />} title="Needs attention">
      {nothing ? (
        <div className="flex items-center gap-3 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-text">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden /> Nothing needs attention. Good start.
        </div>
      ) : (
        <div className="space-y-5">
          {!!a.pending_people && (
            <Link to="/admin/approvals" className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted">
              <ShieldCheck className="size-4 text-primary-text" aria-hidden />
              <span className="flex-1"><b>{a.pending_people}</b> {a.pending_people === 1 ? "person is" : "people are"} waiting for approval</span>
              <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
            </Link>
          )}
          {a.missing_results.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly results not entered</h3>
              <ul className="flex flex-wrap gap-2">
                {a.missing_results.map((g) => <li key={g.person}><Badge tone="warning">{g.person} · {g.weeks} {g.weeks === 1 ? "week" : "weeks"}</Badge></li>)}
              </ul>
              <Link to="/kpi" className="mt-2 inline-block text-sm font-semibold text-primary-text hover:underline">Enter weekly results</Link>
            </div>
          )}
          {a.stuck && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stuck deals</h3>
              {a.stuck.shared_pipelines === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has shared their pipeline with admins yet, so stuck deals can't be checked.</p>
              ) : a.stuck.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stuck deals in the {a.stuck.shared_pipelines} shared {a.stuck.shared_pipelines === 1 ? "pipeline" : "pipelines"}.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {a.stuck.items.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <CalendarClock className="size-4 text-danger-text" aria-hidden />
                      <span className="font-semibold">{d.company}</span>
                      <Badge tone="outline">{d.stage}</Badge>
                      <span className="text-muted-foreground">{d.owner}</span>
                      <span className="ml-auto text-xs font-medium text-danger-text">{d.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              {a.stuck.total > a.stuck.items.length && <p className="mt-2 text-xs text-muted-foreground">And {a.stuck.total - a.stuck.items.length} more in Team pipelines.</p>}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Focus({ h }: { h: HuddleData }) {
  const qc = useQueryClient();
  const f = h.focus;
  const [text, setText] = useState(f.current?.text ?? f.suggested.text);
  const post = useMutation({
    mutationFn: async () => (await api.post("/ops/huddle/focus/", { text: text.trim() })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Today's focus is posted", { description: "It's pinned on everyone's dashboard until midnight." });
    },
    onError: (e) => toast.error("Couldn't post the focus", { description: errorText(e) }),
  });
  return (
    <Section icon={<Target />} title="One focus for today">
      <div className="rounded-lg bg-primary-soft px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-text">Suggested from the numbers</p>
        <p className="mt-1 text-base font-medium text-foreground">{f.suggested.text}</p>
      </div>
      {f.current && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-success/30 bg-success-soft px-4 py-3">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-success-text">Today's focus</p>
            <p className="mt-0.5 text-foreground">{f.current.text}</p>
            {f.current.by && <p className="mt-1 text-xs text-muted-foreground">Posted by {f.current.by}</p>}
          </div>
        </div>
      )}
      {f.can_set && (
        <form className="mt-5" onSubmit={(e) => { e.preventDefault(); post.mutate(); }}>
          <label className="label" htmlFor="focus-text">{f.current ? "Change today's focus" : "Agree one focus and post it"}</label>
          <Textarea id="focus-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} className="min-h-20" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">It's pinned on everyone's dashboard until midnight.</p>
            <Button type="submit" busy={post.isPending} disabled={text.trim().length < 3}><Megaphone /> Post as today's focus</Button>
          </div>
        </form>
      )}
    </Section>
  );
}

const SECTIONS = [
  { key: "yesterday", label: "Yesterday", View: Yesterday },
  { key: "plan", label: "Today's plan", View: TodaysPlan },
  { key: "attention", label: "Needs attention", View: Attention },
  { key: "focus", label: "One focus", View: Focus },
] as const;

/** One section at a time, full screen, with a 10-minute timer: for running the huddle on a projector or shared screen. */
function Presenter({ h, onClose }: { h: HuddleData; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(600);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") setI((x) => Math.min(SECTIONS.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { View, label } = SECTIONS[i];
  const over = left <= 0, mm = Math.floor(Math.abs(left) / 60), ss = String(Math.abs(left) % 60).padStart(2, "0");
  return (
    <div role="dialog" aria-modal="true" aria-label="Morning huddle" className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-4 border-b border-border px-6 py-3">
        <Sunrise className="size-5 text-primary-text" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Morning huddle · {date(h.today, "weekday")}</p>
          <p className="text-xs text-muted-foreground">{i + 1} of {SECTIONS.length} · {label}</p>
        </div>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
          over ? "bg-danger-soft text-danger-text" : left < 120 ? "bg-warning-soft text-warning-text" : "bg-muted text-foreground")}>
          <Timer className="size-4" aria-hidden />{over ? `Time's up · +${mm}:${ss}` : `${mm}:${ss}`}
        </span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the huddle"><X /></Button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div key={i} className="mx-auto max-w-4xl duration-300 animate-in fade-in slide-in-from-right-4" style={{ zoom: 1.25 }}>
          <View h={h} />
        </div>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-6 py-3">
        <Button variant="secondary" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}><ChevronLeft /> Back</Button>
        <div className="flex gap-2" aria-hidden>
          {SECTIONS.map((s, n) => <span key={s.key} className={cn("size-2 rounded-full", n === i ? "bg-primary" : "bg-input")} />)}
        </div>
        {i < SECTIONS.length - 1
          ? <Button onClick={() => setI((x) => x + 1)}>Next <ChevronRight /></Button>
          : <Button onClick={onClose}><CheckCircle2 /> Finish</Button>}
      </footer>
    </div>
  );
}

export default function Huddle() {
  const q = useQuery({ queryKey: KEY, queryFn: async () => (await api.get<HuddleData>("/ops/huddle/")).data, refetchInterval: 60_000 });
  const [presenting, setPresenting] = useState(false);
  if (q.isLoading) return <PageSkeleton stats={0} charts={2} rows={0} />;
  if (q.isError || !q.data) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const h = q.data;
  return (
    <>
      <PageHeader title="Morning huddle" subtitle={<>Ten minutes, four things: yesterday, today's plan, what needs attention, one focus. · Week {h.week_no}</>}
        actions={<Button onClick={() => setPresenting(true)}><Presentation /> Start huddle</Button>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Yesterday h={h} />
        <TodaysPlan h={h} />
        <Attention h={h} />
        <Focus key={h.focus.current?.text ?? "none"} h={h} />
      </div>
      {presenting && <Presenter h={h} onClose={() => setPresenting(false)} />}
    </>
  );
}
