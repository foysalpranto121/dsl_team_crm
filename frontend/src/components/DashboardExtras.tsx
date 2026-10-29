import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Megaphone, Pin, Plus, Trash2, Trophy, X } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Card, Field, Input, Textarea } from "./ui";

interface Announcement { id: number; title: string; body: string; pinned: boolean; expires_on: string | null; created_by: string | null; created_at: string }
interface Leader { id: number; person: string; role: string | null; score: number | null; points: number; hours: number; ytd_points: number }

/** Admin messages at the top of the dashboard. */
export function Announcements() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const list = useQuery({ queryKey: ["announcements"], queryFn: async () => (await api.get<Announcement[]>("/announcements/")).data });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", body: "", pinned: false, expires_on: "" });
  const add = useMutation({ mutationFn: async () => (await api.post("/announcements/", { ...f, expires_on: f.expires_on || null })).data,
    onSuccess: () => { setF({ title: "", body: "", pinned: false, expires_on: "" }); setOpen(false); qc.invalidateQueries({ queryKey: ["announcements"] }); } });
  const del = useMutation({ mutationFn: async (id: number) => api.delete(`/announcements/${id}/`), onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }) });
  const items = list.data ?? [];
  if (!items.length && !isAdmin) return null;

  return (
    <div className="mb-6 grid gap-3">
      {items.map((a) => (
        <div key={a.id} className={clsx("flex gap-3 rounded-2xl border p-4", a.pinned ? "border-accent-300 bg-accent-500/[0.06]" : "border-brand-200 bg-brand-50 dark:border-brand-400/20 dark:bg-brand-400/10")}>
          <span className={clsx("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-4", a.pinned ? "bg-accent-500 text-white" : "bg-brand-700 text-white")}>
            {a.pinned ? <Pin /> : <Megaphone />}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{a.title}</div>
            {a.body && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{a.body}</p>}
            <div className="mt-1 text-xs text-slate-500">{a.created_by} · {new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {a.expires_on && ` · until ${new Date(a.expires_on + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`}</div>
          </div>
          {isAdmin && <button type="button" onClick={() => del.mutate(a.id)} aria-label={`Remove "${a.title}"`} className="self-start rounded-lg p-1.5 text-slate-400 hover:bg-white/60 hover:text-accent-600"><Trash2 className="size-4" /></button>}
        </div>
      ))}
      {isAdmin && (open ? (
        <Card className="p-4">
          <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={140} placeholder="e.g. This week: 2 demos each" /></Field>
            <Field label="Show until (optional)"><Input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
            <Field label="Message" className="sm:col-span-2"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={3000} /></Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top</label>
              <Button type="submit" busy={add.isPending}>Post announcement</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}><X className="size-4" /> Cancel</Button>
            </div>
            {add.error && <div className="sm:col-span-2"><Alert>{errorText(add.error)}</Alert></div>}
          </form>
        </Card>
      ) : <div><Button variant="secondary" onClick={() => setOpen(true)}><Plus className="size-4" /> New announcement</Button></div>)}
    </div>
  );
}

const METRICS = [["score", "Score this month"], ["points", "Points this month"], ["hours", "Hours this week"]] as const;
const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-800", "bg-orange-300 text-orange-950"];

/** Who is leading: score so far this month, points this month, or hours this week. */
export function Leaderboard() {
  const [by, setBy] = useState<(typeof METRICS)[number][0]>("score");
  const q = useQuery({ queryKey: ["leaderboard"], queryFn: async () => (await api.get<{ rows: Leader[] }>("/team/leaderboard/")).data });
  const rows = [...(q.data?.rows ?? [])].sort((a, b) => (b[by] ?? -1) - (a[by] ?? -1));
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => r[by] ?? 0), 0.0001);
  const show = (r: Leader) => by === "score" ? (r.score == null ? "—" : `${Math.round(r.score * 100)}%`) : by === "hours" ? `${r.hours} h` : `${Math.round(r.points * 10) / 10}`;
  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold"><Trophy className="size-5 text-amber-500" /> Leaderboard</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist">{METRICS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)}
            className={clsx("rounded-full border px-3 py-1 text-xs font-semibold", by === k ? "border-brand-700 bg-brand-700 text-white dark:border-brand-300 dark:bg-brand-300 dark:text-brand-950" : "border-slate-300 dark:border-white/15")}>{l}</button>))}</div>
      </div>
      <ol className="mt-4 grid gap-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center gap-3">
            <span className={clsx("num grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", MEDAL[i] ?? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300")}>{i + 1}</span>
            <div className="w-40 min-w-0 shrink-0"><div className="truncate text-sm font-semibold">{r.person}</div><div className="truncate text-xs text-slate-500">{r.role}</div></div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div className={clsx("h-full rounded-full", i === 0 ? "bg-leaf-500" : "bg-brand-600 dark:bg-brand-300")} style={{ width: `${Math.max(2, ((r[by] ?? 0) / top) * 100)}%` }} />
            </div>
            <span className="num w-16 text-right text-sm font-medium">{show(r)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">Score = role-weighted progress against each person's own targets, so different roles compare fairly.</p>
    </Card>
  );
}
