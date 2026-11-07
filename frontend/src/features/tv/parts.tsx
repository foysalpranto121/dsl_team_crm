import { Trophy } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FeedWin } from "./types";

/* Pieces of the TV screen. Sizes use vh so the same page reads well on a 1080p or a 4K TV. */

export function TvAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return src
    ? <img src={src} alt="" referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover ring-4 ring-white/10", className)} />
    : <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-primary font-semibold text-white ring-4 ring-white/10", className)}>{initials}</span>;
}

type RingTone = "primary" | "success" | "warning" | "danger";
const ringFill: Record<RingTone, string> = { primary: "stroke-primary", success: "stroke-success", warning: "stroke-warning", danger: "stroke-danger" };
const ringTrack: Record<RingTone, string> = { primary: "stroke-primary-soft", success: "stroke-success-soft", warning: "stroke-warning-soft", danger: "stroke-danger-soft" };

/** A progress ring that scales with its box (viewBox units), for TV-sized numbers in the middle. */
export function TvRing({ value, max, tone = "primary", label, children, className }: {
  value: number; max: number; tone?: RingTone; label: string; children?: ReactNode; className?: string;
}) {
  const r = 44, c = 2 * Math.PI * r, p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}
      className={cn("relative grid shrink-0 place-items-center", className)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth={9} className={ringTrack[tone]} />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth={9} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)}
          className={cn(ringFill[tone], "transition-[stroke-dashoffset] duration-1000 ease-out")} />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

const CONFETTI = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#2fbf73", "#f2b23a"];

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr; };
    size();
    const bits = Array.from({ length: 170 }, () => ({
      x: Math.random() * canvas.width, y: -Math.random() * canvas.height * 0.7,
      w: (6 + Math.random() * 8) * dpr, h: (9 + Math.random() * 10) * dpr,
      vx: (Math.random() - 0.5) * 2.4 * dpr, vy: (2.2 + Math.random() * 3.6) * dpr,
      a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.22, color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
    }));
    const start = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fade = Math.max(0, 1 - Math.max(0, t - start - 6000) / 1800);
      ctx.globalAlpha = fade;
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.a += b.va;
        if (b.y > canvas.height + b.h) b.y = -b.h;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (fade > 0) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", size);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[61] size-full" aria-hidden />;
}

/** A short rising chime made in the browser (no sound file). Plays only after someone has clicked the page once —
    browsers block sound until then. */
export function playChime(ctx: AudioContext | null) {
  if (!ctx || ctx.state !== "running") return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}

/** Full-screen celebration for a new win (SRS FR-TV3 / FR-MO5). Closes by itself after 10 seconds, or on a click. */
export function Celebration({ win, onDone }: { win: FeedWin; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 10_000);
    return () => window.clearTimeout(t);
  }, [win.id, onDone]);
  return (
    <div role="alert" aria-live="assertive" onClick={onDone}
      // An opaque base with a soft blue glow on top, so nothing on the panel behind shows through the name.
      style={{ background: "radial-gradient(ellipse at center, rgba(47,111,208,0.42), rgba(47,111,208,0) 62%), #060a14" }}
      className="fixed inset-0 z-[60] grid place-items-center duration-500 animate-in fade-in">
      <Confetti />
      <div className="relative z-[62] flex flex-col items-center px-[4vw] text-center duration-700 animate-in zoom-in-90">
        <div className="relative">
          <TvAvatar name={win.person} src={win.photo} className="size-[18vh] text-[6vh] ring-[0.8vh] ring-warning/40" />
          <span className="absolute -bottom-[1vh] -right-[1vh] grid size-[7vh] place-items-center rounded-full bg-warning text-[#2d2410] ring-[0.6vh] ring-[#0a0f1a]">
            <Trophy className="size-[3.6vh]" aria-hidden />
          </span>
        </div>
        <p className="mt-[4vh] text-[2.2vh] font-semibold uppercase tracking-[0.35em] text-warning">New win</p>
        <p className="mt-[1.5vh] font-display text-[9vh] font-extrabold leading-none text-white">{win.person}</p>
        <p className="mt-[2.2vh] text-[3.6vh] font-medium text-slate-200">{win.what}</p>
        {win.details && <p className="mt-[1.5vh] max-w-[70vw] text-[2.6vh] text-slate-300">{win.details}</p>}
      </div>
    </div>
  );
}
