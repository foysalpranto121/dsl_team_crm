import { ArrowLeft, ArrowRight, BookOpen, CalendarCheck2, CheckCircle2, CircleHelp, Clock, GraduationCap, Inbox, Lightbulb, RotateCcw, Sparkles, Target } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { StepTracker, Timeline, type StepState } from "@/components/data/steps";
import { StatCard } from "@/components/data/stat-card";
import { EmptyState } from "@/components/data/states";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { date, money, num } from "@/lib/format";
import { useLocalState } from "@/lib/use-local-state";
import { cn } from "@/lib/utils";
import { ACTIVITIES, CURRENCY, DAY30, HELP_TEXTS, METRICS, NEW_JOINERS, ONBOARDING_STEPS, PLAN_TEMPLATES, ROLES, targetsFor, type MetricKey } from "./mock";
import { CardTitle, pctOf, PreviewPage, sample, ScrollX, TH, TH_NUM } from "./parts";

const ROLE = "ai" as const;
const STEP_MINUTES = [2, 1, 3, 2, 1];
const WORKING_DAYS = 6;

const GAP: Record<MetricKey, (t: number) => string> = {
  hours: (t) => `About ${num(t / WORKING_DAYS, 0)} hours a working day. Fill the hour slots in your plan and it counts by itself.`,
  points: (t) => `About ${num(t / WORKING_DAYS, 0)} points a working day. They come from the activities you log.`,
  leads: (t) => `${num(t)} companies that have a real need and a budget. Move them to Qualified Lead in your pipeline.`,
  opps: (t) => `${num(t)} of those leads share their requirements with you.`,
  clients: (t) => `${num(t)} signed work order${t === 1 ? "" : "s"}, verified by your supervisor.`,
  revenue: (t) => `${money(t, { compact: true, currency: CURRENCY })} of verified work orders.`,
};

interface Progressing { step: number; template: string | null; slots: string[]; half: boolean; sent: boolean; practice: "done" | "partly" | "not" | null; remarks: string }
const START: Progressing = { step: 0, template: null, slots: [], half: false, sent: false, practice: null, remarks: "" };

function Panel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (<><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{intro}</p><div className="mt-5">{children}</div></>);
}

function StepRole() {
  const r = ROLES[ROLE];
  const weights = METRICS.filter((m) => r.weights[m.key]).sort((a, b) => r.weights[b.key] - r.weights[a.key]);
  return (
    <Panel title={`You're in ${r.name}`} intro={r.plain}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">What counts here</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />Output, not time at your desk. An hour slot you fill counts as one hour, however long the work really took.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />You plan your hours, {r.supervisor} approves them, then you log them.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />Your Home screen tells you what to do next, every day.</li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">How your score is made up</h3>
          <ul className="mt-2 space-y-2">{weights.map((m) => (
            <li key={m.key}><div className="flex justify-between text-sm"><span>{m.label}</span><span className="tabular-nums text-muted-foreground">{r.weights[m.key]}%</span></div>
              <Progress value={r.weights[m.key]} size="sm" label={`${m.label}: ${r.weights[m.key]}% of your score`} className="mt-1" /></li>))}</ul>
        </div>
      </div>
    </Panel>
  );
}

function StepTargets() {
  const t = targetsFor(ROLE, "week");
  return (
    <Panel title="This week's targets" intro="This is your learning week: your numbers are visible, but they stay out of any ranking.">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {METRICS.filter((m) => t[m.key]).map((m) => (
          <li key={m.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
            <span className="text-sm font-medium">{m.label}</span>
            <span className="text-sm font-semibold tabular-nums">{m.key === "revenue" ? money(t[m.key], { compact: true, currency: CURRENCY }) : num(t[m.key])}{m.key === "hours" ? " hours" : ""}</span>
            <span className="w-full text-sm text-muted-foreground">{GAP[m.key](t[m.key])}</span>
          </li>))}
      </ul>
    </Panel>
  );
}

function StepPlan({ s, set }: { s: Progressing; set: (p: Partial<Progressing>) => void }) {
  const chosen = PLAN_TEMPLATES.find((t) => t.key === s.template);
  const count = s.half ? 5 : 10;
  return (
    <Panel title="Your first plan" intro="Start from a template made for your role. You can change any hour, then send it for approval.">
      <div role="group" aria-label="Plan templates" className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-3">
        {PLAN_TEMPLATES.map((t) => (
          <button key={t.key} type="button" aria-pressed={s.template === t.key} disabled={s.sent} onClick={() => set({ template: t.key, slots: t.slots })}
            className={cn("rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-70", s.template === t.key ? "border-primary bg-primary-soft" : "border-border hover:border-input")}>
            <span className="block text-sm font-medium">{t.name}</span><span className="block text-xs text-muted-foreground">{t.why}</span>
          </button>))}
      </div>
      {chosen && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Sunday 1 November</h3>
            <div role="group" aria-label="How much of the day" className="inline-flex rounded-lg bg-muted p-0.5">
              {([[false, "Full day"], [true, "Half day"]] as const).map(([v, name]) => (
                <button key={name} type="button" aria-pressed={s.half === v} disabled={s.sent} onClick={() => set({ half: v })}
                  className={cn("h-7 rounded-md px-3 text-xs font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:h-11", s.half === v && "bg-card text-foreground shadow-xs")}>{name}</button>))}
            </div>
          </div>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {s.slots.slice(0, count).map((a, i) => (
              <li key={i} className="flex items-center gap-2"><span className="w-9 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">H-{i + 1}</span>
                <NativeSelect aria-label={`Activity for H-${i + 1}`} value={a} disabled={s.sent} className="min-w-0" onChange={(e) => set({ slots: s.slots.map((x, j) => (j === i ? e.target.value : x)) })}>{ACTIVITIES.map((o) => <option key={o}>{o}</option>)}</NativeSelect></li>))}
          </ul>
          {s.sent ? <p className="mt-4 flex items-center gap-2 text-sm text-success-text" role="status"><CheckCircle2 className="size-4" aria-hidden />Sent. {ROLES[ROLE].supervisor} approves it, and it appears on your Home screen.</p>
            : <Button className="mt-4" onClick={() => { set({ sent: true }); sample("Plan sent for approval"); }}>Send to {ROLES[ROLE].supervisor}</Button>}
        </>
      )}
    </Panel>
  );
}

function StepPractice({ s, set }: { s: Progressing; set: (p: Partial<Progressing>) => void }) {
  const say = { done: "One output hour and 1 point would be added.", partly: "It would count, and your remark tells your supervisor what's left.", not: "It would count as zero. Say why, and it's not held against you if your plan changed." };
  return (
    <Panel title="Try logging an hour" intro="This is what you'll do each day. It takes two taps, and this one is only practice.">
      <div className="rounded-lg border border-dashed border-input p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-muted-foreground">H-1 · Planned</div><div className="text-sm font-medium">Make 8 Cold Calls</div></div><Badge tone="info"><GraduationCap aria-hidden />Practice: not scored</Badge></div>
        <div role="group" aria-label="How did this hour go?" className="mt-3 flex flex-wrap gap-2">
          {([["done", "Done"], ["partly", "Partly"], ["not", "Not done"]] as const).map(([k, name]) => <Button key={k} variant={s.practice === k ? "primary" : "secondary"} className="max-sm:h-11" aria-pressed={s.practice === k} onClick={() => set({ practice: k })}>{name}</Button>)}
        </div>
        <Field label="Daily remarks" hint="The one place you type freely. Optional for now." className="mt-3"><Input value={s.remarks} maxLength={160} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. Called the Dhaka list" /></Field>
        {s.practice && <p className="mt-3 flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm" role="status"><Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /><span>{say[s.practice]} <strong className="font-medium">Nothing has been counted, because this is practice.</strong></span></p>}
      </div>
    </Panel>
  );
}

function StepFinish({ s, minutes }: { s: Progressing; minutes: number }) {
  const list: [string, boolean][] = [["You know your role and how it's scored", true], ["You've seen this week's targets", true], ["Your first plan is sent", s.sent], ["You've tried logging an hour", !!s.practice]];
  return (
    <Panel title="You're ready" intro={`That took about ${minutes} minutes. Your Home screen shows what to do next from here on.`}>
      <ul className="space-y-2 text-sm">{list.map(([t, ok]) => <li key={t} className="flex items-center gap-2">{ok ? <CheckCircle2 className="size-4 text-success-text" aria-hidden /> : <Clock className="size-4 text-muted-foreground" aria-hidden />}{t}{!ok && <span className="text-muted-foreground">: you can do this from Home</span>}</li>)}</ul>
      <Button className="mt-5" asChild><Link to="/home">Finish and open Home <ArrowRight /></Link></Button>
    </Panel>
  );
}

/** FR-G1: five steps, at most 10 minutes, resumable. */
function Wizard() {
  const [s, setS] = useLocalState<Progressing>("preview.onboarding", START);
  const set = (p: Partial<Progressing>) => setS({ ...s, ...p });
  const left = STEP_MINUTES.slice(s.step).reduce((a, b) => a + b, 0);
  const steps = ONBOARDING_STEPS.map((label, i): { label: string; state: StepState } => ({ label, state: i < s.step ? "done" : i === s.step ? "current" : "upcoming" }));
  const blocked = s.step === 2 && !s.sent ? "Send your plan first" : s.step === 3 && !s.practice ? "Try one of the three buttons first" : null;
  return (
    <section className="card mx-auto max-w-3xl p-5 sm:p-6" aria-label="Onboarding steps">
      <StepTracker steps={steps} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">Step {s.step + 1} of {steps.length} · about {left} minute{left === 1 ? "" : "s"} left</span>
        <Button size="sm" variant="ghost" onClick={() => setS(START)}><RotateCcw /> Start again</Button>
      </div>
      <div className="mt-4 border-t border-border pt-5" aria-live="polite">
        {s.step === 0 && <StepRole />}{s.step === 1 && <StepTargets />}{s.step === 2 && <StepPlan s={s} set={set} />}{s.step === 3 && <StepPractice s={s} set={set} />}{s.step === 4 && <StepFinish s={s} minutes={STEP_MINUTES.reduce((a, b) => a + b, 0)} />}
      </div>
      {s.step < 4 && <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" disabled={s.step === 0} onClick={() => set({ step: s.step - 1 })}><ArrowLeft /> Back</Button>
        <div className="flex flex-wrap items-center gap-2">
          {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
          <Button variant="secondary" onClick={() => sample("Saved. It reopens at this step next time")}>Finish later</Button>
          <Button disabled={!!blocked} onClick={() => set({ step: s.step + 1 })}>Next <ArrowRight /></Button>
        </div>
      </div>}
    </section>
  );
}

function SupervisorView() {
  const done = NEW_JOINERS.filter((p) => p.step >= 5).length;
  const started = NEW_JOINERS.filter((p) => p.step > 0);
  const avg = NEW_JOINERS.filter((p) => p.step >= 5).reduce((a, p) => a + p.minutes, 0) / (done || 1);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <StatCard label="Finished" value={done} target={NEW_JOINERS.length} />
        <StatCard label="In progress" value={started.length - done} footer="Stopped part-way? They carry on where they left off." />
        <StatCard label="Average time" value={num(avg, 0)} unit="minutes" footer="The goal is 10 minutes or less." />
      </div>
      <section className="card overflow-hidden" aria-labelledby="joiners-title">
        <CardTitle id="joiners-title" title="New people" note="Who has finished onboarding, and who might need a nudge." />
        <ScrollX label="New people's onboarding">
          <table className="w-full min-w-[42rem] text-sm">
            <thead><tr className="border-b border-border"><th className={TH}>Person</th><th className={TH}>Role</th><th className={TH}>Joined</th><th className={TH}>Progress</th><th className={TH}>Last active</th><th className={TH_NUM}><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{NEW_JOINERS.map((p) => (
              <tr key={p.name} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 font-medium">{p.name}</td><td className="px-3 py-2.5 text-muted-foreground">{ROLES[p.role].name}</td><td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{date(p.joined, "short")}</td>
                <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Progress value={p.step} max={5} size="sm" tone={p.step >= 5 ? "success" : "primary"} label={`${p.name}: step ${p.step} of 5`} className="w-20" /><span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{p.step >= 5 ? "Finished" : p.step ? `Step ${p.step} of 5` : "Not started"}</span></div></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{p.active}</td>
                <td className="px-3 py-2.5 text-right">{p.step < 5 && <Button size="sm" variant="secondary" onClick={() => sample(`Nudge sent to ${p.name}`)}>Send a nudge</Button>}</td>
              </tr>))}</tbody>
          </table>
        </ScrollX>
      </section>
    </div>
  );
}

function HelpTip({ field, text }: { field: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={`Help: ${field}`} className="ml-1 inline-grid size-5 place-items-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"><CircleHelp className="size-4" aria-hidden /></button></PopoverTrigger>
      <PopoverContent className="w-72 text-sm">{text}</PopoverContent>
    </Popover>
  );
}

const TOUR = [
  { spot: "ring", title: "Your day at a glance", text: "The ring fills as you finish things. You can't lose it: it starts fresh each morning." },
  { spot: "next", title: "What to do next", text: "One action at a time, in order, so you never have to work out what comes next." },
  { spot: "close", title: "Close your day", text: "Two minutes at the end of the day, and your supervisor knows where you got to." },
];

function HelpAndTours() {
  const [texts, setTexts] = useState(HELP_TEXTS);
  const [editing, setEditing] = useState<{ id: string; field: string; text: string } | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const on = (spot: string) => tour != null && TOUR[tour].spot === spot;
  const hl = (spot: string) => cn("rounded-lg border p-3 transition-shadow", on(spot) ? "border-primary ring-2 ring-primary" : "border-border");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
      <section className="card p-5" aria-labelledby="tour-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="tour-title" className="text-sm font-semibold">A short tour</h2><Button size="sm" variant="secondary" onClick={() => setTour(0)}><BookOpen /> Replay the tour</Button></div>
        <p className="mt-0.5 text-xs text-muted-foreground">Anyone can replay it at any time from the help menu.</p>
        <div className="mt-4 grid gap-2">
          <div className={hl("ring")}><div className="text-xs text-muted-foreground">Today</div><div className="text-sm font-semibold tabular-nums">4 of 10 done</div></div>
          <div className={hl("next")}><div className="text-xs text-muted-foreground">Next</div><div className="text-sm font-semibold">Call Meghna Textiles</div></div>
          <div className={hl("close")}><div className="text-xs text-muted-foreground">End of the day</div><div className="text-sm font-semibold">Close my day</div></div>
        </div>
        {tour != null && (
          <div className="mt-4 rounded-lg bg-primary-soft p-3" role="status">
            <div className="text-xs font-semibold tabular-nums text-primary-text">Stop {tour + 1} of {TOUR.length}</div>
            <div className="mt-0.5 text-sm font-semibold">{TOUR[tour].title}</div><p className="text-sm">{TOUR[tour].text}</p>
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => setTour(tour + 1 < TOUR.length ? tour + 1 : null)}>{tour + 1 < TOUR.length ? "Next" : "Finish"}</Button><Button size="sm" variant="ghost" onClick={() => setTour(null)}>Skip</Button></div>
          </div>)}
      </section>
      <section className="card overflow-hidden" aria-labelledby="help-title">
        <CardTitle id="help-title" title="Help on every field" note="Tap the ? beside a field. Admins can reword any of it for your company." />
        <ul className="divide-y divide-border">{texts.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><div className="min-w-0 flex-1 basis-56"><span className="text-sm font-medium">{h.field}</span><HelpTip field={h.field} text={h.text} /><p className="text-xs text-muted-foreground">{h.text}</p></div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>Edit</Button></li>))}</ul>
      </section>
      <section className="card lg:col-span-2" aria-label="A teaching empty state">
        <EmptyState icon={<Inbox />} title="No pipeline records yet" action={<Button onClick={() => sample("This opens the quick-add form")}>Add your first client</Button>}>A record is how a lead gets counted. It takes about 15 seconds, and your KPIs update by themselves.</EmptyState>
      </section>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); if (editing) { setTexts(texts.map((t) => (t.id === editing.id ? editing : t))); sample("Help text updated"); setEditing(null); } }}>
            <DialogHeader><DialogTitle>Help for {editing?.field}</DialogTitle><DialogDescription>Everyone in your company sees this wording.</DialogDescription></DialogHeader>
            <DialogBody><Field label="Help text"><Textarea value={editing?.text ?? ""} className="min-h-24" onChange={(e) => editing && setEditing({ ...editing, text: e.target.value })} /></Field></DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function First30Days() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
      <section className="card p-5" aria-labelledby="learning-title">
        <h2 id="learning-title" className="flex items-center gap-2 text-sm font-semibold"><GraduationCap className="size-4 text-muted-foreground" aria-hidden />Week 1: learning mode</h2>
        <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info-text" role="status">You're in your learning week. Your score is here for you to learn from, and it stays out of any ranking until Saturday.</p>
        <div className="mt-4"><Timeline items={[
          { id: 1, title: "Days 1 to 7: learning mode", time: "Week 1", description: "Scores are visible, and left out of rankings.", icon: <GraduationCap />, tone: "primary" },
          { id: 2, title: "Week 2: counted", time: "Day 8", description: "Your numbers join the team's. Targets are prorated from the day you joined.", icon: <Target />, tone: "neutral" },
          { id: 3, title: "Day 30: your review", time: "Optional", description: "A one-page review made from your own numbers.", icon: <CalendarCheck2 />, tone: "neutral" },
        ]} /></div>
      </section>
      <section className="card p-5" aria-labelledby="day30-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="day30-title" className="text-sm font-semibold">Day-30 review: {DAY30.name}</h2><Badge tone="outline"><Sparkles aria-hidden />Made from your numbers</Badge></div>
        <p className="text-xs text-muted-foreground tabular-nums">{DAY30.from} to {DAY30.to}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Output hours a week</dt><dd className="text-xl font-semibold tabular-nums">{num(DAY30.hours)}</dd></div><div><dt className="text-xs text-muted-foreground">Plan adherence</dt><dd className="text-xl font-semibold tabular-nums">{pctOf(DAY30.adherence)}</dd></div></dl>
        <ul className="mt-3 space-y-1.5 text-sm"><li><span className="text-muted-foreground">First win:</span> {DAY30.firstWin}</li><li><span className="text-muted-foreground">Strongest activity:</span> {DAY30.strongest}</li><li><span className="text-muted-foreground">What improved:</span> {DAY30.improved}</li></ul>
        <p className="mt-3 flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm"><Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />{DAY30.focus}</p>
        <div className="mt-3"><StatusPill status="info">Your supervisor sees this too</StatusPill></div>
      </section>
    </div>
  );
}

/** SRS v0.5 §5.10 on sample data. */
export default function Onboarding() {
  return (
    <PreviewPage title="Onboarding" subtitle="A new person's first 10 minutes, what their supervisor sees, help and tours, and the first 30 days.">
      <Tabs defaultValue="steps">
        <TabsList className="mb-5"><TabsTrigger value="steps">New person's 5 steps</TabsTrigger><TabsTrigger value="supervisor">Supervisor's view</TabsTrigger><TabsTrigger value="help">Help and tours</TabsTrigger><TabsTrigger value="days30">First 30 days</TabsTrigger></TabsList>
        <TabsContent value="steps"><Wizard /></TabsContent>
        <TabsContent value="supervisor"><SupervisorView /></TabsContent>
        <TabsContent value="help"><HelpAndTours /></TabsContent>
        <TabsContent value="days30"><First30Days /></TabsContent>
      </Tabs>
    </PreviewPage>
  );
}
