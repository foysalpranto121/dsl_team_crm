import { CalendarOff, CheckCircle2, Download, FileUp, GraduationCap, Plus, TriangleAlert, Umbrella } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Choice, RadioGroup, RadioGroupItem, Switch } from "@/components/ui/form-controls";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { date, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  composite, CSV_ROWS, CURRENCY, DEFAULT_THRESHOLDS, LEAVE_START, METRICS, OCT_DAYS, OCT_FIRST_DOW, OVERRIDES, PACKS, PEOPLE, scoreOf, targetsFor, TEAM_HOLIDAYS, WEEKLY_OFF_DOW, type DayType,
} from "./mock";
import { CardTitle, pctOf, PreviewPage, sample, ScorePill, ScrollX, TH, TH_NUM } from "./parts";

function SaveRow({ what }: { what: string }) { return <Button className="mt-4" onClick={() => sample(`${what} saved`)}>Save</Button>; }

/* ---------- FR-C2 ---------- */
function CalendarTab() {
  const [minutes, setMinutes] = useState(60);
  const [slots, setSlots] = useState(10);
  const [lock, setLock] = useState("23:59");
  const dayHours = (minutes * slots) / 60;
  const needed = Math.ceil(40 / (minutes / 60));
  return (
    <section className="card max-w-3xl p-5" aria-labelledby="cal-title">
      <h2 id="cal-title" className="text-base font-semibold">Slots and calendar</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Week start, weekly off and holidays are already in Team setup. Slot length is new.</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Field label="Slot length" hint="A filled slot counts as this much, however long the work took."><NativeSelect value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m === 60 ? "1 hour" : m < 60 ? `${m} minutes` : `${m / 60} hours`}</option>)}</NativeSelect></Field>
        <Field label="Slots per day"><Input type="number" min={1} max={24} value={slots} onChange={(e) => setSlots(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} /></Field>
        <Field label="Daily lock time"><Input type="time" value={lock} onChange={(e) => setLock(e.target.value)} /></Field>
      </div>
      <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm" role="status" data-slot-effect>A full day is <strong className="font-semibold tabular-nums">{num(dayHours)} output hours</strong>, shown as H-1 to H-{slots}. A 40-hour week needs <strong className="font-semibold tabular-nums">{needed} filled slots</strong>.</p>
      <SaveRow what="Calendar" />
    </section>
  );
}

/* ---------- FR-C7 ---------- */
function ThresholdsTab() {
  const [on, setOn] = useState(100);
  const [near, setNear] = useState(80);
  const [capped, setCapped] = useState(false);
  const [cap, setCap] = useState(120);
  const bad = near >= on ? "Near has to be below On target." : null;
  const t = bad ? DEFAULT_THRESHOLDS : { on: on / 100, near: near / 100 };
  const show = (r: number) => (capped ? Math.min(r, cap / 100) : r);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
      <section className="card p-5" aria-labelledby="th-title">
        <h2 id="th-title" className="text-base font-semibold">Status thresholds</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">What counts as On target and Near, everywhere in the app.</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field label="On target from" error={bad ?? undefined}><div className="relative"><Input type="number" min={1} max={200} value={on} onChange={(e) => setOn(Number(e.target.value))} className="pr-7" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>%</span></div></Field>
          <Field label="Near from"><div className="relative"><Input type="number" min={0} max={199} value={near} onChange={(e) => setNear(Number(e.target.value))} className="pr-7" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>%</span></div></Field>
        </div>
        <div className="mt-4"><Choice label="Cap the score" description="Stops one big win from hiding a weak month." control={<Switch aria-label="Cap the score" checked={capped} onCheckedChange={setCapped} />} />
          {capped && <Field label="Highest score" className="mt-2 w-32 pl-12"><Input type="number" min={100} max={300} value={cap} onChange={(e) => setCap(Number(e.target.value) || 100)} /></Field>}</div>
        <Button className="mt-4" disabled={!!bad} onClick={() => sample("Thresholds saved. They apply from this month")}>Save</Button>
      </section>
      <section className="card overflow-hidden" aria-labelledby="th-prev-title">
        <CardTitle id="th-prev-title" title="What that does" note="This month's sample scores with those settings." />
        <table className="w-full text-sm"><thead><tr className="border-b border-border"><th scope="col" className={TH}>Person</th><th scope="col" className={TH_NUM}>Score</th><th scope="col" className={TH}>Status</th></tr></thead>
          <tbody>{PEOPLE.map((p) => <tr key={p.id} className="border-b border-border last:border-0"><th scope="row" className="px-3 py-2 text-left font-medium">{p.name}</th><td className="px-3 py-2 text-right tabular-nums">{pctOf(show(scoreOf(p, "month")))}</td><td className="px-3 py-2"><ScorePill ratio={show(scoreOf(p, "month"))} thresholds={t} /></td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

/* ---------- FR-C8 ---------- */
function ApprovalTab() {
  const [approver, setApprover] = useState("Rezaul Karim");
  const [backup, setBackup] = useState("Demo Admin");
  const [sla, setSla] = useState(24);
  const [windowH, setWindowH] = useState(48);
  const [mode, setMode] = useState("provisional");
  return (
    <section className="card max-w-3xl p-5" aria-labelledby="ap-title">
      <h2 id="ap-title" className="text-base font-semibold">Approval policy</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Who approves, how quickly, and what happens when it takes too long.</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field label="Approver"><NativeSelect value={approver} onChange={(e) => setApprover(e.target.value)}><option>Rezaul Karim</option><option>Demo Admin</option></NativeSelect></Field>
        <Field label="Next approver" hint="Gets anything past the window."><NativeSelect value={backup} onChange={(e) => setBackup(e.target.value)}><option>Demo Admin</option><option>Rezaul Karim</option></NativeSelect></Field>
        <Field label="Approval SLA, in hours" hint="Late ones are flagged on the Team Board."><Input type="number" min={1} max={168} value={sla} onChange={(e) => setSla(Number(e.target.value) || 1)} /></Field>
        <Field label="Deviation window, in hours" hint="Older pending deviations go up to the next approver."><Input type="number" min={1} max={336} value={windowH} onChange={(e) => setWindowH(Number(e.target.value) || 1)} /></Field>
      </div>
      <fieldset className="mt-4"><legend className="label">Unplanned hours</legend>
        <RadioGroup value={mode} onValueChange={setMode} aria-label="Unplanned hours">
          <Choice label="Count them now" description="The supervisor can still edit, delete or flag them." control={<RadioGroupItem value="provisional" />} />
          <Choice label="Count them only after approval" control={<RadioGroupItem value="strict" />} />
        </RadioGroup>
      </fieldset>
      <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm" role="status">A deviation waits for {approver} for up to {num(windowH)} hours, then goes to {approver === backup ? "the same person, so choose someone else" : backup}. It never approves itself.</p>
      <SaveRow what="Approval policy" />
    </section>
  );
}

/* ---------- FR-C5 ---------- */
function OverridesTab() {
  const [rows, setRows] = useState(OVERRIDES);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ who: PEOPLE[0].name, what: "Weekly hours", to: "", effective: null as string | null, why: "" });
  const fromOf: Record<string, string> = { "Weekly hours": "40", "Target: Points": "350", "Target: Qualified leads": "20", "Weight: Revenue": "30%" };
  return (
    <section className="card overflow-hidden" aria-labelledby="ov-title">
      <CardTitle id="ov-title" title="Individual overrides" note="For one person, from a date you choose. Earlier months keep the numbers they had at the time." action={<Button size="sm" onClick={() => { setF({ who: PEOPLE[0].name, what: "Weekly hours", to: "", effective: null, why: "" }); setOpen(true); }}><Plus /> Add override</Button>} />
      <ScrollX label="Individual overrides">
        <table className="w-full min-w-[42rem] text-sm"><thead><tr className="border-b border-border"><th scope="col" className={TH}>Person</th><th scope="col" className={TH}>What changes</th><th scope="col" className={TH_NUM}>From</th><th scope="col" className={TH_NUM}>To</th><th scope="col" className={TH}>Effective from</th><th scope="col" className={TH}>Why</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-border last:border-0"><th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{r.who}</th><td className="px-3 py-2.5">{r.what}</td><td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.from}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.to}</td><td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{date(r.effective)}</td><td className="px-3 py-2.5 text-muted-foreground">{r.why}</td></tr>)}</tbody></table>
      </ScrollX>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); setRows([{ id: `o${Date.now()}`, who: f.who, what: f.what, from: fromOf[f.what], to: f.to, effective: f.effective!, why: f.why || "—" }, ...rows]); setOpen(false); sample("Override added"); }}>
            <DialogHeader><DialogTitle>Add an override</DialogTitle><DialogDescription>It applies from the date you pick. Nothing before that date changes.</DialogDescription></DialogHeader>
            <DialogBody className="space-y-3">
              <Field label="Person"><NativeSelect value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>{PEOPLE.map((p) => <option key={p.id}>{p.name}</option>)}</NativeSelect></Field>
              <Field label="What changes"><NativeSelect value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })}>{Object.keys(fromOf).map((k) => <option key={k}>{k}</option>)}</NativeSelect></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="New value" required hint={`Now ${fromOf[f.what]}`}><Input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field><Field label="Effective from" required><DatePicker value={f.effective} onChange={(v) => setF({ ...f, effective: v })} aria-label={f.effective ? `Effective from ${date(f.effective)}` : "Choose the date it starts"} /></Field></div>
              <Field label="Why"><Input value={f.why} maxLength={120} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="Goes in the audit log" /></Field>
            </DialogBody>
            <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!f.to.trim() || !f.effective}>Add override</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------- FR-C3 ---------- */
function CsvTab() {
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const ok = CSV_ROWS.filter((r) => !r.problem), bad = CSV_ROWS.filter((r) => r.problem);
  const download = () => {
    const lines = ["Category,Task,Scoring mode,Points", ...ok.map((r) => `${r.category},${r.task},${r.mode},${r.points}`)];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: "activity-catalogue.csv" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="card p-5" aria-labelledby="csv-title">
        <h2 id="csv-title" className="text-base font-semibold">Activity catalogue, as a CSV</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Download the list, change it in Excel, and bring it back. Nothing changes until you've seen a check of every row.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={download}><Download /> Download the catalogue</Button><Button onClick={() => { setChecked(true); setDone(false); }}><FileUp /> Check a sample file</Button></div>
      </section>
      {checked && (
        <section className="card overflow-hidden" aria-labelledby="dry-title">
          <CardTitle id="dry-title" title="Check before importing" note={<span data-csv-summary>{CSV_ROWS.length} rows: {ok.length} ready, {bad.length} to fix. Nothing has changed yet.</span>}
            action={done ? <StatusPill status="good">{ok.length} imported</StatusPill> : <Button size="sm" onClick={() => { setDone(true); sample(`${ok.length} rows imported`); }}>Import the {ok.length} ready rows</Button>} />
          <ScrollX label="Rows in the file">
            <table className="w-full min-w-[46rem] text-sm"><thead><tr className="border-b border-border"><th scope="col" className={TH_NUM}>Row</th><th scope="col" className={TH}>Category</th><th scope="col" className={TH}>Task</th><th scope="col" className={TH}>Mode</th><th scope="col" className={TH_NUM}>Points</th><th scope="col" className={TH}>Check</th></tr></thead>
              <tbody>{CSV_ROWS.map((r) => <tr key={r.row} className={cn("border-b border-border last:border-0", r.problem && "bg-warning-soft/40")}><td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.row}</td><td className="px-3 py-2">{r.category}</td><td className="px-3 py-2">{r.task}</td><td className="px-3 py-2">{r.mode}</td><td className="px-3 py-2 text-right tabular-nums">{r.points}</td><td className="px-3 py-2">{r.problem ? <span className="flex items-start gap-1.5 text-warning-text"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{r.problem}</span> : <span className="flex items-center gap-1.5 text-success-text"><CheckCircle2 className="size-3.5" aria-hidden />Ready</span>}</td></tr>)}</tbody></table>
          </ScrollX>
        </section>)}
    </div>
  );
}

/* ---------- FR-C10 ---------- */
function PacksTab() {
  const [packs, setPacks] = useState(PACKS);
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">{packs.map((p) => (
      <li key={p.key} className="card flex flex-col p-5"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-base font-semibold">{p.name}</h2>{p.installed && <StatusPill status="good">Imported</StatusPill>}</div><p className="mt-1 text-sm">{p.what}</p><p className="mt-1 text-xs text-muted-foreground">{p.counts}</p>
        <div className="mt-auto pt-3"><Button size="sm" variant={p.installed ? "ghost" : "secondary"} disabled={p.installed} onClick={() => { setPacks(packs.map((x) => (x.key === p.key ? { ...x, installed: true } : x))); sample(`${p.name} imported. You can edit all of it`); }}>{p.installed ? "Already in your team" : "Import as editable data"}</Button></div></li>))}</ul>
  );
}

/* ---------- §6, §7: leave handling ---------- */
const DAY_LOOK: Record<DayType, { cls: string; word: string; mark: string }> = {
  work: { cls: "border-border bg-card hover:border-input", word: "working day", mark: "" }, leave: { cls: "border-info/40 bg-info-soft text-info-text", word: "leave", mark: "Leave" }, training: { cls: "border-primary/40 bg-primary-soft text-primary-text", word: "training", mark: "Training" },
  holiday: { cls: "border-border bg-muted text-muted-foreground", word: "team holiday", mark: "Holiday" }, off: { cls: "border-transparent bg-transparent text-subtle-foreground", word: "weekly off", mark: "" },
};
const DOW = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

function LeaveTab() {
  const [who, setWho] = useState("arif");
  const [marks, setMarks] = useState(LEAVE_START);
  const p = PEOPLE.find((x) => x.id === who)!;
  const mine = marks[who];
  const typeOf = (d: number): DayType => { const dow = (OCT_FIRST_DOW + d - 1) % 7; return dow === WEEKLY_OFF_DOW ? "off" : TEAM_HOLIDAYS[d] ? "holiday" : mine[d] ?? "work"; };
  const days = Array.from({ length: OCT_DAYS }, (_, i) => i + 1);
  const normal = days.filter((d) => typeOf(d) !== "off").length;
  const excluded = days.filter((d) => ["leave", "training", "holiday"].includes(typeOf(d))).length;
  const factor = (normal - excluded) / normal;
  const t = targetsFor(p.role, "month"), a = p.actual.month;
  const before = composite(p.role, a, t), after = composite(p.role, a, t, factor);
  const cycle = (d: number) => { const c = mine[d] ?? "work"; const next: DayType = c === "work" ? "leave" : c === "leave" ? "training" : "work"; const copy = { ...mine }; if (next === "work") delete copy[d]; else copy[d] = next; setMarks({ ...marks, [who]: copy }); };
  const blanks = (OCT_FIRST_DOW - 6 + 7) % 7;
  const show = (key: (typeof METRICS)[number]["key"], v: number) => (key === "revenue" ? money(v, { compact: true, currency: CURRENCY }) : num(v, 1));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="card p-5" aria-labelledby="leave-cal-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="leave-cal-title" className="text-base font-semibold">October 2026</h2><Field label="Person" className="w-52"><NativeSelect value={who} onChange={(e) => setWho(e.target.value)}>{PEOPLE.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field></div>
        <p className="mt-1 text-xs text-muted-foreground">Tap a day to mark leave, tap again for training, and once more to clear it.</p>
        <div className="mt-3 grid grid-cols-7 gap-1" role="group" aria-label="Days in October">
          {DOW.map((d) => <div key={d} className="pb-1 text-center text-xs font-medium text-muted-foreground" aria-hidden>{d}</div>)}
          {Array.from({ length: blanks }, (_, i) => <div key={`b${i}`} />)}
          {days.map((d) => {
            const k = typeOf(d), look = DAY_LOOK[k], fixed = k === "off" || k === "holiday";
            return <button key={d} type="button" disabled={fixed} onClick={() => cycle(d)} aria-label={`${d} October, ${look.word}`} className={cn("flex min-h-12 flex-col items-center justify-center rounded-lg border p-0.5 text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", look.cls, fixed && "cursor-default")}>{d}{look.mark && <span className="max-w-full truncate text-[9px] leading-tight sm:text-[10px]">{look.mark}</span>}</button>;
          })}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><li className="flex items-center gap-1"><Umbrella className="size-3.5" aria-hidden />Leave</li><li className="flex items-center gap-1"><GraduationCap className="size-3.5" aria-hidden />Training</li><li className="flex items-center gap-1"><CalendarOff className="size-3.5" aria-hidden />Team holiday, set in Team setup</li></ul>
      </section>
      <section className="card overflow-hidden" aria-labelledby="prorate-title">
        <CardTitle id="prorate-title" title={`${p.name}'s targets`} note={<span data-excluded>{excluded} of {normal} working days excluded, so targets are {pctOf(factor)} of normal.</span>} />
        <ScrollX label="Prorated targets">
          <table className="w-full min-w-[26rem] text-sm"><thead><tr className="border-b border-border"><th scope="col" className={TH}>Metric</th><th scope="col" className={TH_NUM}>Actual</th><th scope="col" className={TH_NUM}>Normal target</th><th scope="col" className={TH_NUM}>With days off</th></tr></thead>
            <tbody className="tabular-nums">{METRICS.filter((m) => t[m.key]).map((m) => <tr key={m.key} className="border-b border-border last:border-0"><th scope="row" className="px-3 py-2 text-left font-medium">{m.label}</th><td className="px-3 py-2 text-right">{show(m.key, a[m.key])}</td><td className="px-3 py-2 text-right text-muted-foreground">{show(m.key, t[m.key])}</td><td className="px-3 py-2 text-right font-semibold">{show(m.key, t[m.key] * factor)}</td></tr>)}</tbody></table>
        </ScrollX>
        <div className="border-t border-border p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><div><div className="text-xs text-muted-foreground">Score without this</div><div className="text-xl font-semibold tabular-nums" data-before>{pctOf(before)}</div></div><div><div className="text-xs text-muted-foreground">Score with days off taken out</div><div className="flex items-center gap-2 text-xl font-semibold tabular-nums"><span data-after>{pctOf(after)}</span><ScorePill ratio={after} /></div></div></div>
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground"><li>Excluded days aren't counted against anyone, and they don't lower adherence.</li><li>Leave and holidays never break a streak.</li><li>The same sum applies to someone who joins part-way through a month.</li></ul>
        </div>
      </section>
    </div>
  );
}

/** SRS v0.5 §5.1, §6, §7 on sample data. */
export default function ConfigAndLeave() {
  return (
    <PreviewPage title="The remaining configuration gaps and leave handling" subtitle="The settings v0.5 asks for that Team setup doesn't have yet, and how days off change targets.">
      <Tabs defaultValue="leave">
        <TabsList className="mb-5"><TabsTrigger value="leave">Leave handling</TabsTrigger><TabsTrigger value="calendar">Slot length</TabsTrigger><TabsTrigger value="thresholds">Thresholds</TabsTrigger><TabsTrigger value="approval">Approver and SLA</TabsTrigger><TabsTrigger value="overrides">Overrides</TabsTrigger><TabsTrigger value="csv">Activity CSV</TabsTrigger><TabsTrigger value="packs">Template packs</TabsTrigger></TabsList>
        <TabsContent value="leave"><LeaveTab /></TabsContent>
        <TabsContent value="calendar"><CalendarTab /></TabsContent>
        <TabsContent value="thresholds"><ThresholdsTab /></TabsContent>
        <TabsContent value="approval"><ApprovalTab /></TabsContent>
        <TabsContent value="overrides"><OverridesTab /></TabsContent>
        <TabsContent value="csv"><CsvTab /></TabsContent>
        <TabsContent value="packs"><PacksTab /></TabsContent>
      </Tabs>
    </PreviewPage>
  );
}
