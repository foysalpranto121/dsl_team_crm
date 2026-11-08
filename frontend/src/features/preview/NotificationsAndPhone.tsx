import { AlarmClock, BadgeCheck, Bell, BellOff, Briefcase, CalendarClock, CalendarDays, CheckCircle2, CloudOff, Download, House, ListTodo, MoreHorizontal, NotebookPen, Plus, RefreshCw, Smartphone, TimerOff, Trophy, UserPlus, Wifi, WifiOff, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Choice, RadioGroup, RadioGroupItem, Switch } from "@/components/ui/form-controls";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ACTIVITIES, NOTICE_KINDS, NOTICES, TODAY_SLOTS, type NoticeKind, type Slot } from "./mock";
import { CardTitle, PreviewPage, sample, ScrollX, TH } from "./parts";

const KIND_ICON: Record<NoticeKind, { icon: LucideIcon; cls: string }> = {
  plan_submitted: { icon: CalendarClock, cls: "bg-primary-soft text-primary-text" }, plan_decided: { icon: BadgeCheck, cls: "bg-success-soft text-success-text" }, deviation_pending: { icon: TimerOff, cls: "bg-warning-soft text-warning-text" },
  missing_log: { icon: AlarmClock, cls: "bg-warning-soft text-warning-text" }, sla_breach: { icon: AlarmClock, cls: "bg-danger-soft text-danger-text" }, kpi_due: { icon: CalendarDays, cls: "bg-primary-soft text-primary-text" },
};
type Channel = "app" | "phone";
interface Prefs { channels: Record<NoticeKind, Record<Channel, boolean>>; quiet: boolean; from: string; to: string; digest: "instant" | "daily"; digestAt: string; cap: number }
const START: Prefs = {
  channels: Object.fromEntries(NOTICE_KINDS.map((k) => [k.key, { app: true, phone: k.key === "missing_log" || k.key === "plan_decided" }])) as Prefs["channels"],
  quiet: true, from: "22:00", to: "08:00", digest: "instant", digestAt: "18:00", cap: 10,
};
const hourOf = (t: string) => Number(t.split(":")[0]);
const inQuiet = (h: number, from: number, to: number) => (from > to ? h >= from || h < to : h >= from && h < to);

type Delivery = { how: "now" } | { how: "held"; until: string } | { how: "digest"; at: string; why: string } | { how: "off" };
/** What each person's own settings do to the day's notifications (FR-N1). */
function deliver(list: typeof NOTICES, p: Prefs): Record<string, Delivery> {
  const out: Record<string, Delivery> = {};
  let shown = 0;
  for (const n of [...list].sort((a, b) => a.hour - b.hour)) {
    const c = p.channels[n.kind];
    if (!c.app && !c.phone) out[n.id] = { how: "off" };
    else if (p.digest === "daily") out[n.id] = { how: "digest", at: p.digestAt, why: "Daily digest" };
    else if (p.quiet && inQuiet(n.hour, hourOf(p.from), hourOf(p.to))) out[n.id] = { how: "held", until: p.to };
    else if (shown >= p.cap) out[n.id] = { how: "digest", at: p.digestAt, why: "Over your daily cap" };
    else { out[n.id] = { how: "now" }; shown += 1; }
  }
  return out;
}

function DeliveryBadge({ d }: { d: Delivery }) {
  if (d.how === "held") return <Badge tone="info"><BellOff aria-hidden />Held until {d.until}</Badge>;
  if (d.how === "digest") return <Badge tone="info"><NotebookPen aria-hidden />{d.why}, {d.at}</Badge>;
  if (d.how === "off") return <Badge tone="neutral"><BellOff aria-hidden />Off</Badge>;
  return null;
}

function NotificationsTab() {
  const [who, setWho] = useState<"member" | "supervisor">("member");
  const [prefs, setPrefs] = useState(START);
  const [read, setRead] = useState<string[]>([]);
  const [only, setOnly] = useState<"all" | "unread">("all");
  const list = NOTICES.filter((n) => n.forWho === who);
  const kinds = NOTICE_KINDS.filter((k) => k.who === who || k.who === "both");
  const fate = useMemo(() => deliver(list, prefs), [list, prefs]);
  const counts = list.reduce((c, n) => { c[fate[n.id].how] += 1; return c; }, { now: 0, held: 0, digest: 0, off: 0 } as Record<Delivery["how"], number>);
  const visible = list.filter((n) => (only === "all" || !read.includes(n.id)) && fate[n.id].how !== "off");
  const unread = list.filter((n) => !read.includes(n.id) && fate[n.id].how !== "off").length;
  const setChannel = (k: NoticeKind, c: Channel, v: boolean) => setPrefs({ ...prefs, channels: { ...prefs.channels, [k]: { ...prefs.channels[k], [c]: v } } });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="card overflow-hidden" aria-labelledby="inbox-title">
        <CardTitle id="inbox-title" title="Notifications" note={<span data-delivery-summary>{list.length} today: {counts.now} as they happened{counts.held ? `, ${counts.held} held for quiet hours` : ""}{counts.digest ? `, ${counts.digest} in the digest` : ""}{counts.off ? `, ${counts.off} switched off` : ""}.</span>}
          action={<div className="flex flex-wrap items-center gap-2"><Segmented label="Whose" value={who} onChange={(v) => { setWho(v); setRead([]); }} options={[{ key: "member", label: "Member" }, { key: "supervisor", label: "Supervisor" }]} /><Segmented label="Show" value={only} onChange={setOnly} options={[{ key: "all", label: "All" }, { key: "unread", label: "Unread", count: unread }]} /></div>} />
        {visible.length ? (
          <ul className="divide-y divide-border">{visible.map((n) => {
            const K = KIND_ICON[n.kind], isRead = read.includes(n.id);
            return (
              <li key={n.id}>
                <button type="button" onClick={() => setRead(isRead ? read : [...read, n.id])} className="flex w-full gap-3 px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", K.cls)}><K.icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3"><span className={cn("text-sm", isRead ? "font-normal" : "font-semibold")}>{!isRead && <><span className="mr-1.5 inline-block size-2 rounded-full bg-primary align-middle" aria-hidden /><span className="sr-only">Unread: </span></>}{n.title}</span><span className="text-xs tabular-nums text-muted-foreground">{n.at}</span></span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                    {fate[n.id].how !== "now" && <span className="mt-1 block"><DeliveryBadge d={fate[n.id]} /></span>}
                  </span>
                </button>
              </li>);
          })}</ul>
        ) : <div className="flex flex-col items-center gap-1 px-6 py-10 text-center"><CheckCircle2 className="size-7 text-success" aria-hidden /><p className="text-sm font-medium">You're all caught up</p><p className="text-xs text-muted-foreground">Your Playbook is the main place to look. This is only for what can't wait.</p></div>}
        {unread > 0 && <div className="border-t border-border px-5 py-2"><Button size="sm" variant="ghost" onClick={() => setRead(list.map((n) => n.id))}>Mark all as read</Button></div>}
      </section>
      <section className="card overflow-hidden" aria-labelledby="prefs-title">
        <CardTitle id="prefs-title" title="My notification settings" note="Each person chooses for themselves." />
        <ScrollX label="Which alerts go where">
          <table className="w-full min-w-[24rem] text-sm">
            <thead><tr className="border-b border-border"><th scope="col" className={TH}>Alert</th><th scope="col" className={cn(TH, "text-center")}>In-app</th><th scope="col" className={cn(TH, "text-center")}>Phone</th><th scope="col" className={cn(TH, "text-center")}>Email</th><th scope="col" className={cn(TH, "text-center")}>WhatsApp</th></tr></thead>
            <tbody>{kinds.map((k) => (
              <tr key={k.key} className="border-b border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal">{k.label}</th>
                {(["app", "phone"] as const).map((c) => <td key={c} className="px-3 py-2 text-center"><Switch aria-label={`${k.label}: ${c === "app" ? "in-app" : "phone"}`} checked={prefs.channels[k.key][c]} onCheckedChange={(v) => setChannel(k.key, c, v)} /></td>)}
                <td className="px-3 py-2 text-center"><Switch aria-label={`${k.label}: email, coming later`} disabled checked={false} /></td><td className="px-3 py-2 text-center"><Switch aria-label={`${k.label}: WhatsApp, coming later`} disabled checked={false} /></td>
              </tr>))}</tbody>
          </table>
        </ScrollX>
        <p className="px-5 pt-2 text-xs text-muted-foreground">Email and WhatsApp come in a later phase.</p>
        <div className="space-y-4 p-5">
          <div>
            <Choice label="Quiet hours" description="Hold alerts during these hours. Nothing is lost." control={<Switch aria-label="Quiet hours" checked={prefs.quiet} onCheckedChange={(v) => setPrefs({ ...prefs, quiet: v })} />} />
            {prefs.quiet && <div className="mt-2 grid grid-cols-2 gap-3 pl-12"><Field label="From"><Input type="time" value={prefs.from} onChange={(e) => setPrefs({ ...prefs, from: e.target.value })} /></Field><Field label="To"><Input type="time" value={prefs.to} onChange={(e) => setPrefs({ ...prefs, to: e.target.value })} /></Field></div>}
          </div>
          <fieldset><legend className="label">How they arrive</legend>
            <RadioGroup value={prefs.digest} onValueChange={(v) => setPrefs({ ...prefs, digest: v as Prefs["digest"] })} aria-label="How they arrive">
              <Choice label="As they happen" control={<RadioGroupItem value="instant" />} /><Choice label="One digest a day" description={`Everything together at ${prefs.digestAt}.`} control={<RadioGroupItem value="daily" />} />
            </RadioGroup>
          </fieldset>
          <Field label="Daily cap" hint="After this many, the rest wait for the digest."><Input type="number" min={1} max={50} value={prefs.cap} className="w-24" onChange={(e) => setPrefs({ ...prefs, cap: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <Button onClick={() => sample("Settings saved")}>Save settings</Button>
        </div>
      </section>
    </div>
  );
}

/* ---------- FR-Q1, FR-Q2, §10.4: logging on a phone, online or not ---------- */
interface PhoneSlot extends Slot { queued?: boolean; how?: "Done" | "Partly" | "Not done" }
const NEW_ITEMS: { label: string; icon: LucideIcon }[] = [{ label: "Log slot", icon: CalendarClock }, { label: "Task", icon: ListTodo }, { label: "Note", icon: NotebookPen }, { label: "Lead", icon: UserPlus }, { label: "Win", icon: Trophy }];
const REASONS = ["Client changed the time", "Called into a meeting", "Plan changed"];
const FIRST = () => TODAY_SLOTS.map((s) => ({ ...s })) as PhoneSlot[];

function PhoneTab() {
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [slots, setSlots] = useState<PhoneSlot[]>(FIRST);
  const [picked, setPicked] = useState<PhoneSlot | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [notDone, setNotDone] = useState(false);
  const [taps, setTaps] = useState(0);
  const [last, setLast] = useState<{ taps: number; text: string } | null>(null);
  const [plus, setPlus] = useState(false);
  const [install, setInstall] = useState(true);
  const queued = slots.filter((s) => s.queued).length;
  const done = slots.filter((s) => s.state === "done").length;

  useEffect(() => {
    if (!online && syncing) setSyncing(false);
    if (!online || !queued) return;
    setSyncing(true);
    const t = setTimeout(() => { setSlots((ss) => ss.map((s) => ({ ...s, queued: false }))); setSyncing(false); sample(`${queued} ${queued === 1 ? "hour" : "hours"} synced`); }, 1200);
    return () => clearTimeout(t);
  }, [online, queued]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (s: PhoneSlot) => { if (s.state === "done" || s.state === "deviation") return; setPicked(s); setActivity(s.activity); setNotDone(false); setTaps(1); };
  const finish = (how: PhoneSlot["how"], used: number) => {
    if (!picked) return;
    const act = activity ?? picked.activity;
    setSlots(slots.map((s) => (s.id === picked.id ? { ...s, activity: act, state: "done", how, queued: !online } : s)));
    setLast({ taps: used, text: `${picked.id} logged as ${how?.toLowerCase()}` }); setPicked(null); setTaps(0);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-[22.5rem]">
        <div className="overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 bg-background shadow-lg" data-phone>
          <div className="relative flex h-[42rem] flex-col">
            <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
              <span className="text-sm font-semibold">Today</span>
              {syncing ? <Badge tone="info"><RefreshCw className="animate-spin" aria-hidden />Syncing</Badge>
                : queued ? <Badge tone="warning" className="tabular-nums" ><CloudOff aria-hidden />{queued} to sync</Badge>
                  : online ? <Badge tone="success"><CheckCircle2 aria-hidden />Up to date</Badge> : <Badge tone="neutral"><WifiOff aria-hidden />Offline</Badge>}
            </div>
            {install && <div className="flex items-center gap-2 border-b border-border bg-primary-soft px-3 py-2 text-sm"><Smartphone className="size-4 shrink-0 text-primary-text" aria-hidden /><span className="min-w-0 flex-1 text-xs">Add TOS to your home screen for one-tap logging.</span><Button size="sm" variant="secondary" onClick={() => { setInstall(false); sample("This is where the phone asks to install it"); }}><Download /> Install</Button><Button size="icon-sm" variant="ghost" aria-label="Not now" onClick={() => setInstall(false)}><X /></Button></div>}
            {!online && <div className="flex items-center gap-2 bg-muted px-3 py-1.5 text-xs" role="status"><WifiOff className="size-3.5 shrink-0" aria-hidden />You're offline. Keep logging, it syncs when you're back.</div>}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <p className="mb-2 text-xs text-muted-foreground tabular-nums">{done} of {slots.length} hours logged. Tap an hour to log it.</p>
              <ul className="space-y-1.5">{slots.map((s) => {
                const fixed = s.state === "done" || s.state === "deviation";
                return (
                  <li key={s.id}>
                    <button type="button" disabled={fixed} onClick={() => pick(s)} aria-label={`${s.id}, ${s.activity ?? "not planned"}, ${s.queued ? "waiting to sync" : s.state === "done" ? "logged" : s.state === "deviation" ? "waiting for a decision" : "log this hour"}`}
                      className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", picked?.id === s.id ? "border-primary ring-2 ring-primary" : "border-border", fixed ? "bg-muted/60" : "bg-card")}>
                      <span className="w-9 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{s.id}</span><span className="min-w-0 flex-1 truncate">{s.activity ?? <span className="text-muted-foreground">Not planned</span>}</span>
                      {s.queued ? <CloudOff className="size-4 shrink-0 text-warning-text" aria-hidden /> : s.state === "done" ? <CheckCircle2 className="size-4 shrink-0 text-success-text" aria-hidden /> : s.state === "deviation" ? <span className="text-[11px] text-warning-text">Waiting</span> : null}
                    </button>
                  </li>);
              })}</ul>
            </div>
            {picked && (
              <div className="absolute inset-x-0 bottom-14 z-10 rounded-t-2xl border-t border-border bg-card p-3 shadow-lg" role="group" aria-label={`Log ${picked.id}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{picked.id}{activity ? `: ${activity}` : ""}</span><Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => { setPicked(null); setTaps(0); }}><X /></Button></div>
                {!activity ? (
                  <div className="mt-2"><p className="mb-1 text-xs text-muted-foreground">What did you do?</p><div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{ACTIVITIES.map((a) => <Button key={a} size="sm" variant="secondary" className="h-11" onClick={() => { setActivity(a); setTaps(2); }}>{a}</Button>)}</div></div>
                ) : notDone ? (
                  <div className="mt-2"><p className="mb-1 text-xs text-muted-foreground">Why? One tap is enough.</p><div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <Button key={r} size="sm" variant="secondary" className="h-11" onClick={() => finish("Not done", taps + 1)}>{r}</Button>)}</div></div>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <Button className="h-11" onClick={() => finish("Done", taps + 1)}>Done</Button><Button className="h-11" variant="secondary" onClick={() => finish("Partly", taps + 1)}>Partly</Button><Button className="h-11" variant="secondary" onClick={() => { setNotDone(true); setTaps(taps + 1); }}>Not done</Button>
                  </div>)}
              </div>)}
            {plus && (
              <div className="absolute inset-x-0 bottom-14 z-10 rounded-t-2xl border-t border-border bg-card p-3 shadow-lg" aria-label="New">
                <div className="mb-1 flex items-center justify-between"><span className="text-sm font-semibold">New</span><Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setPlus(false)}><X /></Button></div>
                <ul>{NEW_ITEMS.map((i) => <li key={i.label}><button type="button" onClick={() => { setPlus(false); sample(`This opens ${i.label}`); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"><i.icon className="size-4 text-muted-foreground" aria-hidden />{i.label}</button></li>)}</ul>
              </div>)}
            <nav aria-label="Phone tabs" className="grid h-14 grid-cols-5 items-center border-t border-border bg-card">
              {([["Home", House, true], ["My Day", CalendarClock, false]] as const).map(([name, Icon, on]) => <span key={name} className={cn("flex flex-col items-center gap-0.5 text-[10px]", on ? "font-semibold text-primary-text" : "text-muted-foreground")}><Icon className="size-5" aria-hidden />{name}</span>)}
              <span className="flex justify-center"><button type="button" aria-label="New" aria-expanded={plus} onClick={() => { setPicked(null); setPlus(!plus); }} className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Plus className="size-5" aria-hidden /></button></span>
              {([["Pipeline", Briefcase], ["More", MoreHorizontal]] as const).map(([name, Icon]) => <span key={name} className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground"><Icon className="size-5" aria-hidden />{name}</span>)}
            </nav>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <section className="card p-5" aria-labelledby="try-title">
          <h2 id="try-title" className="text-sm font-semibold">Try it</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm"><li>Tap <strong className="font-medium">H-5</strong>, then <strong className="font-medium">Done</strong>. A planned hour takes 2 taps.</li><li>Tap <strong className="font-medium">H-10</strong>, pick an activity, then <strong className="font-medium">Done</strong>. An empty hour takes 3.</li><li>Switch to offline, log another hour, then come back online and watch it sync.</li><li>Tap the round <strong className="font-medium">+</strong> for Log slot, Task, Note, Lead and Win.</li></ol>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Choice label={online ? "Online" : "Offline"} description="Pretend the signal comes and goes." control={<Switch aria-label="Online" checked={online} onCheckedChange={setOnline} />} />
            <Button size="sm" variant="ghost" onClick={() => { setSlots(FIRST()); setLast(null); setPicked(null); setTaps(0); setInstall(true); setOnline(true); }}>Start again</Button>
          </div>
          {last && <p className="mt-3 flex items-center gap-2 text-sm" role="status" data-last-log>{online ? <Wifi className="size-4 text-success-text" aria-hidden /> : <WifiOff className="size-4 text-muted-foreground" aria-hidden />}{last.text}, in <strong className="font-semibold tabular-nums">{last.taps} {last.taps === 1 ? "tap" : "taps"}</strong>{last.taps <= 3 && <StatusPill status="good">Within 3</StatusPill>}</p>}
        </section>
        <section className="card p-5" aria-labelledby="states-title">
          <h2 id="states-title" className="text-sm font-semibold">What the top of the screen tells you</h2>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex flex-wrap items-center gap-2"><Badge tone="success"><CheckCircle2 aria-hidden />Up to date</Badge>Everything has reached the server.</li>
            <li className="flex flex-wrap items-center gap-2"><Badge tone="warning"><CloudOff aria-hidden />2 to sync</Badge>Saved on the phone, and sent when the signal returns.</li>
            <li className="flex flex-wrap items-center gap-2"><Badge tone="info"><RefreshCw aria-hidden />Syncing</Badge>Sending now.</li>
            <li className="flex flex-wrap items-center gap-2"><Badge tone="neutral"><WifiOff aria-hidden />Offline</Badge>No signal, and nothing waiting.</li>
          </ul>
        </section>
        <section className="card p-5" aria-labelledby="real-title">
          <h2 id="real-title" className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 text-muted-foreground" aria-hidden />What this preview doesn't do yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">This shows how it looks and flows. The real install, offline storage and sync get built once you're happy with it.</p>
        </section>
      </div>
    </div>
  );
}

/** SRS v0.5 §5.15 on sample data. */
export default function NotificationsAndPhone() {
  return (
    <PreviewPage title="Notifications and the phone app" subtitle="The inbox, each person's own settings, logging an hour in 3 taps, and working offline.">
      <Tabs defaultValue="notifications">
        <TabsList className="mb-5"><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="phone">The phone app</TabsTrigger></TabsList>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
        <TabsContent value="phone"><PhoneTab /></TabsContent>
      </Tabs>
    </PreviewPage>
  );
}
