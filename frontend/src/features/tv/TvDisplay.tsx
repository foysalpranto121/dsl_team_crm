import { useQuery } from "@tanstack/react-query";
import { Crown, Loader2, Maximize, Minimize, Trophy, TrendingUp, Tv, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/Brand";
import { date, money, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fetchFeed, ScreenLinkError } from "./feed";
import { Celebration, playChime, TvAvatar, TvRing } from "./parts";
import { PANELS, type Feed, type FeedMetric, type FeedWin, type PanelKey } from "./types";

/**
 * Office TV mode (SRS v0.3 §14.5). A full-screen, read-only page for a sales-floor TV. It signs in with the screen's
 * own token (from the link's #fragment), polls every 20 seconds, rotates through the chosen panels and celebrates
 * new wins. Only team totals and the top few are shown — never who is behind (FR-MO9, NFR-11).
 */

const POLL_MS = 20_000;

// ---------- small hooks ----------

/** TVs look best dark; restore the person's own theme when leaving the page. */
function useForceDark() {
  useEffect(() => {
    const el = document.documentElement, had = el.classList.contains("dark");
    el.classList.add("dark");
    return () => { if (!had) el.classList.remove("dark"); };
  }, []);
}

function useClock(timeZone: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(t);
  }, []);
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try { return now.toLocaleString("en-GB", { ...o, timeZone }); } catch { return now.toLocaleString("en-GB", o); }
  };
  return { time: fmt({ hour: "2-digit", minute: "2-digit" }), day: fmt({ weekday: "long", day: "numeric", month: "long" }) };
}

/** True after a few seconds without mouse or keys: hides the cursor and the on-screen buttons. */
function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), ms); };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => { window.clearTimeout(t); window.removeEventListener("pointermove", wake); window.removeEventListener("keydown", wake); };
  }, [ms]);
  return idle;
}

/** Browsers allow sound only after a click or key press on the page. The first one turns it on. */
function useSound() {
  const ctx = useRef<AudioContext | null>(null);
  const [on, setOn] = useState(false);
  const enable = useCallback(() => {
    try {
      ctx.current ??= new AudioContext();
      void ctx.current.resume();
      setOn(true);
    } catch { /* no audio on this device */ }
  }, []);
  useEffect(() => {
    const first = () => enable();
    window.addEventListener("pointerdown", first, { once: true });
    window.addEventListener("keydown", first, { once: true });
    return () => { window.removeEventListener("pointerdown", first); window.removeEventListener("keydown", first); };
  }, [enable]);
  return { on, enable, mute: () => setOn(false), play: () => { if (on) playChime(ctx.current); } };
}

/** New wins logged today, queued for celebration. Wins already there when the page opened are not celebrated again. */
function useCelebrations(feed: Feed) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<FeedWin[]>([]);
  useEffect(() => {
    const items = feed.wins.items;
    if (seen.current === null) {
      seen.current = new Set(items.map((w) => w.id));
      return;
    }
    const fresh = items.filter((w) => w.today && !seen.current!.has(w.id)).reverse();   // oldest first
    items.forEach((w) => seen.current!.add(w.id));
    if (fresh.length && feed.screen.celebrate) setQueue((q) => [...q, ...fresh]);
  }, [feed]);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, next };
}

// ---------- panels ----------

function PanelTitle({ eyebrow, title, note }: { eyebrow: string; title: string; note?: ReactNode }) {
  return (
    <div className="mb-[3.5vh] flex items-end justify-between gap-[2vw]">
      <div>
        <p className="text-[1.9vh] font-semibold uppercase tracking-[0.2em] text-primary-text">{eyebrow}</p>
        <h1 className="mt-[0.6vh] text-[5.2vh] font-bold leading-none text-foreground">{title}</h1>
      </div>
      {note && <p className="max-w-[40vw] text-right text-[2vh] text-muted-foreground">{note}</p>}
    </div>
  );
}

const PACE_TEXT: Record<string, { text: string; cls: string }> = {
  met: { text: "Target met", cls: "bg-success-soft text-success-text" },
  onpace: { text: "On pace", cls: "bg-success-soft text-success-text" },
  near: { text: "Nearly on pace", cls: "bg-warning-soft text-warning-text" },
  behind: { text: "Behind pace", cls: "bg-danger-soft text-danger-text" },
  below: { text: "Behind pace", cls: "bg-danger-soft text-danger-text" },
  early: { text: "Just started", cls: "bg-muted text-muted-foreground" },
  none: { text: "No target", cls: "bg-muted text-muted-foreground" },
};

function RingTile({ label, value, target, unit, status, note }: { label: string; value: number; target: number; unit: string; status?: FeedMetric["status"]; note?: string }) {
  const met = target > 0 && value >= target;
  const pace = status ? PACE_TEXT[status.key] : null;
  return (
    <div className="card flex items-center gap-[2.4vw] rounded-[2vh] p-[3vh]">
      <TvRing value={value} max={target} tone={met ? "success" : "primary"} label={`${label}: ${num(value)} of ${num(target)} ${unit}`} className="size-[21vh]">
        <div className="text-[5.4vh] font-semibold leading-none tracking-tight text-foreground">{target > 0 ? pct(value / target) : "—"}</div>
      </TvRing>
      <div className="min-w-0">
        <p className="text-[2.4vh] font-medium text-muted-foreground">{label}</p>
        <p className="mt-[0.8vh] text-[4.6vh] font-semibold leading-none text-foreground">
          {num(value)} <span className="text-[2.4vh] font-medium text-muted-foreground">/ {num(target)} {unit}</span>
        </p>
        {pace && <span className={cn("mt-[1.6vh] inline-block rounded-full px-[1.2vh] py-[0.5vh] text-[1.8vh] font-semibold", pace.cls)}>{pace.text}</span>}
        {note && <p className="mt-[1.6vh] text-[1.9vh] text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

function ProgressPanel({ feed }: { feed: Feed }) {
  const p = feed.progress;
  return (
    <>
      <PanelTitle eyebrow={`Week ${feed.team.week_no} · ${date(feed.team.today, "long")}`} title="Team progress"
        note={`${p.logged_today} of ${p.people} ${p.people === 1 ? "person has" : "people have"} logged hours today`} />
      <div className="grid grid-cols-3 gap-[2vw]">
        <RingTile label="Today" value={p.today.value} target={p.today.target} unit="h" note={p.today.workday ? undefined : "Not a working day"} />
        <RingTile label="This week" value={p.week.value} target={p.week.target} unit="h" status={p.week.status} />
        <RingTile label="This month" value={p.month.value} target={p.month.target} unit="pts" status={p.month.status} />
      </div>
      <div className="mt-[3vh] grid grid-cols-4 gap-[2vw]">
        {p.kpis.map((k) => {
          const ratio = k.pct ?? 0;
          return (
            <div key={k.key} className="card rounded-[2vh] p-[2.6vh]">
              <p className="text-[2.1vh] font-medium text-muted-foreground">{k.label} <span className="text-[1.7vh]">this month</span></p>
              <p className="mt-[1vh] text-[4.4vh] font-semibold leading-none text-foreground">
                {k.value == null ? pct(k.pct) : k.key === "revenue" ? money(k.value, { compact: true }) : num(k.value)}
                {k.value != null && k.target != null && k.target > 0 && (
                  <span className="text-[2.2vh] font-medium text-muted-foreground"> / {k.key === "revenue" ? money(k.target, { compact: true, currency: null }) : num(k.target)}</span>
                )}
                {k.value == null && <span className="text-[2.2vh] font-medium text-muted-foreground"> of target</span>}
              </p>
              <div className="mt-[2vh] h-[1vh] overflow-hidden rounded-full bg-primary-soft">
                <div className={cn("h-full rounded-full transition-[width] duration-1000", ratio >= 1 ? "bg-success" : "bg-primary")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function whenText(w: FeedWin, today: string) {
  if (w.today) return "Today";
  const d = new Date(today + "T00:00:00"), x = new Date(w.day + "T00:00:00");
  return Math.round((d.getTime() - x.getTime()) / 86_400_000) === 1 ? "Yesterday" : date(w.day, "short");
}

function Center({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="flex flex-col items-center">
        <div className="grid size-[12vh] place-items-center rounded-[3vh] bg-primary-soft text-primary-text [&>svg]:size-[6vh]">{icon}</div>
        <p className="mt-[3vh] text-[4vh] font-semibold text-foreground">{title}</p>
        <p className="mt-[1vh] max-w-[55vw] text-[2.4vh] text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function WinsPanel({ feed }: { feed: Feed }) {
  const { configured, items } = feed.wins;
  return (
    <div className="flex h-full flex-col">
      <PanelTitle eyebrow="Last 30 days" title="Recent wins" note={items.length ? `${items.length} ${items.length === 1 ? "win" : "wins"} to celebrate` : undefined} />
      {!configured ? (
        <Center icon={<Trophy />} title="Wins will show here" body="An admin can choose which tasks count as wins in TOS → Admin → TV screens." />
      ) : items.length === 0 ? (
        <Center icon={<Trophy />} title="The next win goes here" body="Log a work order in your sheet and the whole floor celebrates it." />
      ) : (
        <div className="grid grid-cols-3 gap-[2vw]">
          {items.slice(0, 6).map((w) => (
            <div key={w.id} className={cn("card flex items-center gap-[1.6vw] rounded-[2vh] p-[2.6vh]", w.today && "border-warning/50 bg-warning-soft/40")}>
              <TvAvatar name={w.person} src={w.photo} className="size-[10vh] text-[3.4vh]" />
              <div className="min-w-0">
                <p className={cn("inline-flex items-center gap-[0.6vh] text-[1.8vh] font-semibold uppercase tracking-wider", w.today ? "text-warning-text" : "text-muted-foreground")}>
                  {w.today && <Trophy className="size-[2vh]" aria-hidden />}{whenText(w, feed.team.today)}
                </p>
                <p className="mt-[0.6vh] truncate text-[3.2vh] font-semibold leading-tight text-foreground">{w.person}</p>
                <p className="truncate text-[2vh] text-muted-foreground">{w.what}</p>
                {w.details && <p className="mt-[0.6vh] line-clamp-2 text-[1.9vh] text-foreground/80">{w.details}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadersPanel({ feed }: { feed: Feed }) {
  const { mode, rows } = feed.leaders;
  const top = mode === "top";
  return (
    <div className="flex h-full flex-col">
      <PanelTitle eyebrow="This month" title={top ? "Top performers" : "Most improved"}
        note={top ? "Score = hours, points and results against each person's own targets" : "This month's pace compared with last month's result"} />
      {rows.length === 0 ? (
        <Center icon={top ? <Crown /> : <TrendingUp />} title="Leaders appear as the month gets going" body="Log your hours and results — this board updates every few seconds." />
      ) : (
        <div className="flex flex-1 items-end justify-center gap-[2.5vw] pb-[2vh]">
          {rows.map((r, i) => (
            <div key={r.id} className={cn("card relative flex w-[22vw] flex-col items-center rounded-[2.4vh] px-[2vw] text-center",
              i === 0 ? "border-warning/50 pb-[5vh] pt-[6vh]" : "pb-[3.5vh] pt-[4.5vh]")}>
              <span className={cn("absolute -top-[2.6vh] grid size-[5.2vh] place-items-center rounded-full text-[2.4vh] font-bold ring-[0.6vh] ring-background",
                i === 0 ? "bg-warning text-[#2d2410]" : "bg-muted text-foreground")}>
                {i === 0 ? <Crown className="size-[2.6vh]" aria-label="First" /> : i + 1}
              </span>
              <TvAvatar name={r.person} src={r.photo} className={i === 0 ? "size-[16vh] text-[5vh]" : "size-[12vh] text-[4vh]"} />
              <p className="mt-[2.4vh] w-full truncate text-[3.4vh] font-semibold text-foreground">{r.person}</p>
              {r.role && <p className="w-full truncate text-[1.9vh] text-muted-foreground">{r.role}</p>}
              <p className="mt-[2vh] text-[5vh] font-semibold leading-none tracking-tight text-foreground">
                {top ? (r.score != null ? pct(r.score) : `${num(r.points)}`) : <span className="inline-flex items-center gap-[0.6vw] text-success-text"><TrendingUp className="size-[4vh]" aria-hidden />+{pct(r.change ?? 0)}</span>}
              </p>
              <p className="mt-[0.8vh] text-[1.9vh] text-muted-foreground">{top ? (r.score != null ? `score · ${num(r.points)} pts` : "points") : "vs last month"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PANEL_VIEW: Record<PanelKey, (p: { feed: Feed }) => ReactNode> = { progress: ProgressPanel, wins: WinsPanel, leaders: LeadersPanel };

// ---------- the screen ----------

function TvScreen({ feed, failed, updatedAt }: { feed: Feed; failed: boolean; updatedAt: number }) {
  const panels = useMemo(() => feed.screen.panels.filter((p) => p !== "leaders" || feed.leaders.mode !== "off"), [feed.screen.panels, feed.leaders.mode]);
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const idle = useIdle(3500);
  const clock = useClock(feed.team.timezone);
  const sound = useSound();
  const party = useCelebrations(feed);
  const current = panels[index % Math.max(1, panels.length)] ?? "progress";
  const View = PANEL_VIEW[current];
  const seconds = feed.screen.rotate_seconds;

  useEffect(() => {   // rotate, but hold still while a win is being celebrated
    if (panels.length < 2 || party.current) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % panels.length), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [index, panels.length, seconds, party.current]);

  // Chime once per celebrated win (keyed on the win, not on the sound helpers, which are new each render).
  const celebrating = party.current?.id;
  const { play: chime } = sound;
  useEffect(() => { if (celebrating && feed.screen.sound) chime(); }, [celebrating]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % Math.max(1, panels.length));
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + panels.length) % Math.max(1, panels.length));
      else if (e.key.toLowerCase() === "f") toggleFull();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); };
  }, [panels.length, toggleFull]);

  const updated = new Date(updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const wantsSound = feed.screen.sound && feed.screen.celebrate;

  return (
    <div className={cn("flex h-dvh select-none flex-col overflow-hidden bg-background text-foreground", idle && "cursor-none")}>
      <header className="flex items-center gap-[1.4vw] px-[3vw] pb-[2vh] pt-[3vh]">
        <LogoMark className="h-[5vh]" />
        <div className="border-l border-border pl-[1.2vw] leading-tight">
          <p className="font-display text-[2.6vh] font-extrabold text-accent-400">TOS</p>
          <p className="text-[1.9vh] font-medium text-muted-foreground">{feed.team.name}</p>
        </div>
        <div className="ml-auto flex items-center gap-[2.4vw]">
          <p className={cn("inline-flex items-center gap-[0.7vh] text-[1.9vh] font-medium", failed ? "text-warning-text" : "text-muted-foreground")}>
            <span className={cn("size-[1.2vh] rounded-full", failed ? "bg-warning" : "animate-pulse bg-success")} aria-hidden />
            {failed ? "Reconnecting…" : `Live · updated ${updated}`}
          </p>
          <div className="text-right leading-tight">
            <p className="text-[4.4vh] font-semibold tabular-nums tracking-tight">{clock.time}</p>
            <p className="text-[1.8vh] text-muted-foreground">{clock.day} · Week {feed.team.week_no}</p>
          </div>
        </div>
      </header>

      <main key={current} className="min-h-0 flex-1 px-[3vw] py-[2vh] duration-700 animate-in fade-in slide-in-from-bottom-4">
        <View feed={feed} />
      </main>

      {panels.length > 1 && (
        <footer className="flex items-center gap-[2vw] px-[3vw] pb-[3vh] pt-[1vh]">
          <ol className="flex items-center gap-[1.6vw]">
            {panels.map((p) => (
              <li key={p} className={cn("text-[1.9vh] font-medium transition-colors", p === current ? "text-foreground" : "text-subtle-foreground")}>
                {PANELS.find((x) => x.key === p)?.label}
              </li>
            ))}
          </ol>
          <div className="h-[0.6vh] flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div key={`${current}-${index}`} className="h-full rounded-full bg-primary/70"
              style={{ animation: party.current ? "none" : `tv-progress ${seconds}s linear forwards` }} />
          </div>
        </footer>
      )}
      <style>{"@keyframes tv-progress { from { width: 0 } to { width: 100% } }"}</style>

      <div className={cn("fixed bottom-[3vh] right-[3vw] z-50 flex items-center gap-2 transition-opacity duration-300", idle ? "pointer-events-none opacity-0" : "opacity-100")}>
        {wantsSound && (
          <button type="button" onClick={sound.on ? sound.mute : sound.enable}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-popover/90 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-muted">
            {sound.on ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}{sound.on ? "Sound on" : "Turn on sound"}
          </button>
        )}
        <button type="button" onClick={toggleFull}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-popover/90 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-muted">
          {full ? <Minimize className="size-4" /> : <Maximize className="size-4" />}{full ? "Exit full screen" : "Full screen (F)"}
        </button>
      </div>

      {party.current && <Celebration win={party.current} onDone={party.next} />}
    </div>
  );
}

function TvMessage({ title, body, busy }: { title: string; body: string; busy?: boolean }) {
  return (
    <div className="grid h-dvh place-items-center bg-background px-[6vw] text-center text-foreground">
      <div className="flex flex-col items-center">
        <div className="grid size-[12vh] place-items-center rounded-[3vh] bg-primary-soft text-primary-text">
          {busy ? <Loader2 className="size-[6vh] animate-spin" aria-hidden /> : <Tv className="size-[6vh]" aria-hidden />}
        </div>
        <h1 className="mt-[3vh] text-[4.4vh] font-bold">{title}</h1>
        <p className="mt-[1.4vh] max-w-[60vw] text-[2.4vh] text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default function TvDisplay() {
  useForceDark();
  const token = useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, "")).trim(), []);
  const feed = useQuery({
    queryKey: ["display-feed", token],
    queryFn: () => fetchFeed(token),
    enabled: !!token,
    refetchInterval: (q) => (q.state.error instanceof ScreenLinkError ? false : POLL_MS),
    refetchIntervalInBackground: true,
    retry: (n, e) => !(e instanceof ScreenLinkError) && n < 2,
    staleTime: 0,
  });
  useEffect(() => { document.title = feed.data ? `${feed.data.screen.name} · TOS` : "TV screen · TOS"; }, [feed.data]);

  if (!token) return <TvMessage title="This screen isn't set up yet" body="Open the link an admin made in TOS → Admin → TV screens. It ends with # and a long code." />;
  if (feed.error instanceof ScreenLinkError) return <TvMessage title="This screen's link no longer works" body={feed.error.message} />;
  if (!feed.data) {
    return feed.isError
      ? <TvMessage title="Can't reach TOS" body="Trying again in a moment. Check the TV's internet connection." busy />
      : <TvMessage title="Connecting to TOS…" body="The server may take up to a minute to wake up after a quiet spell." busy />;
  }
  return <TvScreen feed={feed.data} failed={feed.isError} updatedAt={feed.dataUpdatedAt} />;
}
