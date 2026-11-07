import { useEffect, useState } from "react";
import { BrandName, Logo } from "../Brand";

/** Shown while the session loads. On the free Render tier the server sleeps, so explain the wait instead of spinning. */
export function BootScreen({ waking }: { waking?: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center" role="status" aria-live="polite">
        <div className="flex items-center gap-3"><Logo className="h-10" /><BrandName /></div>
        <div className="mt-10 h-1 w-48 overflow-hidden rounded-full bg-primary-soft" aria-hidden>
          <div className="h-full w-1/3 animate-boot rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
        </div>
        <p className="mt-5 text-sm font-medium text-foreground">{waking ? "Waking up the server…" : "Loading your workspace…"}</p>
        {waking && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The server sleeps after a quiet spell and takes up to a minute to start. <span className="num">{seconds}s</span>
          </p>
        )}
      </div>
    </div>
  );
}
