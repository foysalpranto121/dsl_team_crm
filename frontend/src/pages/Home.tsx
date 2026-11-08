import { GoogleLogin } from "@react-oauth/google";
import { BarChart3, CalendarClock, CheckCircle2, Clock3, LockKeyhole, ShieldCheck, Table2, Target, UserCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { errorText } from "../api/client";
import { homeFor } from "../lib/nav";
import { useAuth } from "../auth/AuthContext";
import { BrandName, Logo, ThemeToggle } from "../components/Brand";
import { Alert, Spinner } from "../components/ui";

const features: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Table2 />, title: "Daily log", text: "An hour-by-hour log with the tasks of your job role. Hours and points add up as you go." },
  { icon: <Target />, title: "Personal targets", text: "Weekly hours, monthly points, leads, opportunities, clients and revenue, set for each person." },
  { icon: <BarChart3 />, title: "Live team dashboard", text: "See who is on pace and who needs help, with a role-weighted score for every month." },
  { icon: <LockKeyhole />, title: "Locked at midnight", text: "Each day locks at 12 at night, Dhaka time. Admin corrections are recorded with who and when." },
  { icon: <CalendarClock />, title: "Your own pipeline", text: "Prospects, follow-ups and a daily plan for your product, private to you." },
  { icon: <ShieldCheck />, title: "Approved members only", text: "Sign in with Google. An admin approves every new person before they get in." },
];

const steps = [
  { icon: <UserCheck />, title: "Sign in with Google", text: "Use the Google account you work with. First-time sign-ins become an access request." },
  { icon: <Clock3 />, title: "An admin approves you", text: "Admins get an email and approve you as member, viewer or admin. You get an email back." },
  { icon: <CheckCircle2 />, title: "Set up your profile", text: "Add your photo, position, job description and official contact details, and you're in." },
];

/* A small, decorative picture of the dashboard, so people see what they're signing in to. */
function Preview() {
  const bars = [[62, 80], [74, 80], [88, 70], [45, 50], [70, 80]];
  const slots = ["Cold calls", "Follow-up", "Demo", "Proposal", "Team meeting"];
  return (
    <div aria-hidden className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-200/60 via-transparent to-accent-300/30 blur-2xl dark:from-brand-700/30 dark:to-accent-500/10" />
      <div className="card overflow-hidden shadow-xl shadow-brand-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-200 px-4 py-2.5 dark:border-white/10">
          <span className="size-2.5 rounded-full bg-accent-400" /><span className="size-2.5 rounded-full bg-amber-400" /><span className="size-2.5 rounded-full bg-leaf-400" />
          <span className="ml-3 text-xs font-medium text-slate-400">Team dashboard · Week 44</span>
        </div>
        <div className="grid grid-cols-3 gap-3 p-4">
          {[["Team hours", "121", "of 135"], ["Points", "1,898", "this month"], ["Leads", "25", "of 30"]].map(([k, v, s]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{k}</div>
              <div className="num mt-1 text-xl font-medium text-brand-800 dark:text-white">{v}</div>
              <div className="text-[11px] text-slate-400">{s}</div>
            </div>
          ))}
        </div>
        <div className="mx-4 flex h-28 items-end gap-3 rounded-xl border border-slate-100 px-4 pb-3 pt-4 dark:border-white/5">
          {bars.map(([h, t], i) => (
            <div key={i} className="relative flex flex-1 items-end justify-center gap-1">
              <div className="w-3 rounded-t bg-brand-700 dark:bg-brand-300" style={{ height: `${h}px` }} />
              <div className="w-1.5 rounded-t bg-leaf-500" style={{ height: `${t}px` }} />
            </div>
          ))}
        </div>
        <div className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold">Today · Thursday</span><span className="num text-slate-500">5 h · 15 pts</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s, i) => <span key={s} className="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 dark:bg-brand-400/15 dark:text-brand-200">H-{i + 1} {s}</span>)}
            <span className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-400 dark:border-white/15">H-6 …</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { session, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.phase === "signedIn") return <Navigate to={session.user.profile.is_complete ? from || homeFor(session.user.role) : "/welcome"} replace />;
  if (session.phase === "waiting") return <Navigate to="/waiting" replace />;

  const onCredential = async (credential?: string) => {
    if (!credential) { setError("Google didn't return a sign-in. Please try again."); return; }
    setBusy(true); setError("");
    try {
      const next = await signInWithGoogle(credential);
      if (next.phase === "signedIn") navigate(next.user.profile.is_complete ? from || homeFor(next.user.role) : "/welcome", { replace: true });
      else navigate("/waiting", { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (
    <div id="signin" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Sign in to continue</h2>
        <span className="text-xs text-slate-500">New? Your sign-in becomes an access request.</span>
      </div>
      <div className="mt-4 flex min-h-11 items-center">
        {session.phase === "loading" || busy ? <Spinner label={busy ? "Signing you in…" : session.phase === "loading" && session.waking ? "Waking up the server… up to a minute" : "Checking your session…"} />
          : <GoogleLogin onSuccess={(r) => onCredential(r.credential)} onError={() => setError("Google sign-in was cancelled or blocked. Allow pop-ups and try again.")}
              text="continue_with" shape="rectangular" size="large" width="320" logo_alignment="left" />}
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
    </div>
  );

  return (
    <div className="hero-glow min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-transparent bg-white/70 backdrop-blur dark:bg-brand-950/70">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Logo className="h-9" /><BrandName />
          <span className="ml-auto hidden rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 sm:inline dark:border-white/10">Internal · Business Team only</span>
          <ThemeToggle />
          <a href="#signin" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 sm:ml-1">Sign in</a>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:text-brand-200 dark:ring-white/10">
              <span className="size-1.5 rounded-full bg-accent-500" /> Daffodil Software Ltd. · Business Team
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.05] text-brand-900 sm:text-5xl dark:text-white">
              Daily work, pipeline and targets for the Business Team, <span className="text-accent-500">in one place.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
              The Team Operation Sheet as a proper system: fill in your hours, follow up your prospects and see how the whole team is doing, live, with every number calculated the same way for everyone.
            </p>
            <div className="mt-8 max-w-xl">{signIn}</div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
              {["Google sign-in", "Admin approval", "Days lock at midnight (Dhaka)"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-leaf-500" />{t}</li>
              ))}
            </ul>
          </div>
          <Preview />
        </section>

        <section aria-labelledby="features" className="border-y border-slate-200 bg-white/60 py-16 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="features" className="text-2xl font-extrabold text-brand-900 dark:text-white">Everything the team used the Excel sheet for, done properly</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">The same tasks, points, targets and role weightages, without broken formulas or copies that drift apart.</p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="card p-5">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 [&>svg]:size-5 dark:bg-brand-400/15 dark:text-brand-200">{f.icon}</span>
                  <h3 className="mt-4 text-base font-bold">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="access" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="access" className="text-2xl font-extrabold text-brand-900 dark:text-white">How access works</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="relative card p-5">
                <span className="num absolute right-5 top-4 text-3xl font-medium text-slate-200 dark:text-white/10">0{i + 1}</span>
                <span className="grid size-10 place-items-center rounded-xl bg-accent-500 text-white [&>svg]:size-5">{s.icon}</span>
                <h3 className="mt-4 text-base font-bold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-6 text-xs text-slate-500 sm:px-6">
          <Logo className="h-7" />
          <span>© {new Date().getFullYear()} Daffodil Software Ltd. · Business Team Operation System (TOS) · For internal use only</span>
          <span className="sm:ml-auto">We only use your Google name, email and photo.</span>
        </div>
      </footer>
    </div>
  );
}
