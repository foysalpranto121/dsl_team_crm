import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api, errorText } from "../api/client";
import type { JobRole, Task } from "../api/types";
import { Alert, Badge, Button, Card, Field, Input } from "./ui";

const W = [["w_hours", "Hours"], ["w_points", "Points"], ["w_leads", "Leads"], ["w_opps", "Opps"], ["w_clients", "Clients"], ["w_revenue", "Revenue"]] as const;
type WKey = (typeof W)[number][0];

function useRefresh() {
  const qc = useQueryClient();
  return () => ["tasks", "roles", "warnings", "entries", "dashboard", "performance", "leaderboard", "plan-history", "score-ledger", "score-versions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function TaskRow({ t }: { t: Task }) {
  const refresh = useRefresh();
  const save = useMutation({ mutationFn: async (body: Partial<Task>) => (await api.patch(`/team/tasks/${t.id}/`, body)).data, onSuccess: refresh });
  const remove = useMutation({ mutationFn: async () => api.delete(`/team/tasks/${t.id}/`), onSuccess: refresh });
  const cls = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-2 focus:outline-brand-400 dark:hover:border-white/10";
  const onBlur = (k: "type" | "name" | "points") => (e: { target: { value: string } }) => {
    const v = e.target.value.trim();
    if (v && v !== String(t[k])) save.mutate({ [k]: v });
  };
  return (
    <>
      <tr className={clsx("border-b border-slate-100 dark:border-white/5", !t.active && "opacity-70")}>
        <td className="px-2 py-1"><input defaultValue={t.type} onBlur={onBlur("type")} aria-label={`Type of ${t.name}`} className={cls} /></td>
        <td className="px-2 py-1"><input defaultValue={t.name} onBlur={onBlur("name")} aria-label="Task name" className={clsx(cls, "font-medium")} /></td>
        <td className="px-2 py-1"><input type="number" min={0} step={0.5} defaultValue={+t.points} onBlur={onBlur("points")} aria-label={`Points for ${t.name}`} className={clsx(cls, "num w-20 text-right")} /></td>
        <td className="px-3 py-1 text-center"><input type="checkbox" checked={t.scoring_mode === "event"} onChange={(e) => save.mutate({ scoring_mode: e.target.checked ? "event" : "time" })}
          aria-label={`${t.name} counts per event, once a supervisor verifies it`} title="Logged as an event with evidence: it adds its points once a supervisor verifies it, and no hours" /></td>
        <td className="px-3 py-1 text-center"><input type="checkbox" checked={t.active} onChange={(e) => save.mutate({ active: e.target.checked })} aria-label={`${t.name} is in use`} /></td>
        <td className="px-2 py-1 text-right"><button type="button" onClick={() => remove.mutate()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-accent-600 dark:hover:bg-white/10"
          aria-label={`Delete ${t.name}`} title="Delete (only if never used)"><Trash2 className="size-4" /></button></td>
      </tr>
      {(save.error || remove.error) && <tr><td colSpan={6} className="px-3 pb-2"><Alert>{errorText(save.error || remove.error)}</Alert></td></tr>}
    </>
  );
}

function RoleEditor({ role, tasks, onDone }: { role: JobRole | null; tasks: Task[]; onDone: () => void }) {
  const refresh = useRefresh();
  const [name, setName] = useState(role?.name ?? "");
  const [weights, setWeights] = useState<Record<WKey, string>>(() => Object.fromEntries(W.map(([k]) => [k, role ? String(+role[k]) : k === "w_hours" || k === "w_points" ? "50" : "0"])) as Record<WKey, string>);
  const [chosen, setChosen] = useState<Set<number>>(new Set(role?.tasks ?? []));
  const total = W.reduce((s, [k]) => s + (+weights[k] || 0), 0);
  const groups = useMemo(() => { const g = new Map<string, Task[]>(); tasks.filter((t) => t.active || chosen.has(t.id)).forEach((t) => g.set(t.type || "Other", [...(g.get(t.type || "Other") ?? []), t])); return [...g]; }, [tasks, chosen]);
  const save = useMutation({
    mutationFn: async () => { const body = { name: name.trim(), tasks: [...chosen], ...Object.fromEntries(W.map(([k]) => [k, weights[k] || "0"])) };
      return role ? (await api.patch(`/team/roles/${role.id}/`, body)).data : (await api.post("/team/roles/", body)).data; },
    onSuccess: () => { refresh(); onDone(); },
  });
  const toggle = (ids: number[], on: boolean) => setChosen((c) => { const n = new Set(c); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="border-t border-slate-200 bg-slate-50/60 p-5 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_repeat(6,1fr)]">
        <Field label="Job role name"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        {W.map(([k, label]) => <Field key={k} label={`${label} %`}><Input type="number" min={0} max={100} step={1} value={weights[k]} className="num"
          onChange={(e) => setWeights({ ...weights, [k]: e.target.value })} /></Field>)}
      </div>
      <p className={clsx("mt-2 text-sm font-semibold", Math.abs(total - 100) < 0.01 ? "text-leaf-600" : "text-accent-600")}>
        Weightages add up to {total}%{Math.abs(total - 100) < 0.01 ? "" : " — they must add up to 100%"}</p>
      <div className="mt-4 text-sm font-semibold">Tasks this role can pick <span className="font-normal text-slate-500">({chosen.size} chosen)</span></div>
      <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([type, ts]) => {
          const all = ts.every((t) => chosen.has(t.id));
          return (
            <fieldset key={type} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={all} onChange={(e) => toggle(ts.map((t) => t.id), e.target.checked)} />{type}</label>
              </legend>
              {ts.map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={chosen.has(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span><span className="num text-xs text-slate-500">{+t.points}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" busy={save.isPending} disabled={Math.abs(total - 100) >= 0.01}>{role ? "Save job role" : "Create job role"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {save.error && <div className="mt-3"><Alert>{errorText(save.error)}</Alert></div>}
    </form>
  );
}

export default function TasksRoles() {
  const refresh = useRefresh();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const roles = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get<JobRole[]>("/team/roles/")).data });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [nt, setNt] = useState({ type: "", name: "", points: "1" });
  const add = useMutation({
    mutationFn: async () => (await api.post("/team/tasks/", { ...nt, name: nt.name.trim(), type: nt.type.trim(), position: (tasks.data?.length ?? 0) + 1 })).data,
    onSuccess: () => { setNt({ type: nt.type, name: "", points: "1" }); refresh(); },
  });
  if (!tasks.data || !roles.data) return null;
  const shown = tasks.data.filter((t) => `${t.type} ${t.name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div><h2 className="text-base font-bold">Job roles and score weightages</h2>
            <p className="text-xs text-slate-500">Each role decides which tasks appear in a person's dropdowns and how their monthly score is weighted.</p></div>
          <Button variant="secondary" onClick={() => setEditing("new")}><Plus className="size-4" /> New job role</Button>
        </div>
        {editing === "new" && <div className="mt-4"><RoleEditor role={null} tasks={tasks.data} onDone={() => setEditing(null)} /></div>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              <th className="px-5 py-2.5">Job role</th>{W.map(([, l]) => <th key={l} className="px-3 py-2.5 text-right">{l}</th>)}<th className="px-3 py-2.5 text-right">Tasks</th><th />
            </tr></thead>
            <tbody>
              {roles.data.map((r) => [
                <tr key={r.id} className="border-b border-slate-100 dark:border-white/5">
                  <td className="px-5 py-2.5 font-semibold">{r.name} {Math.abs(r.weights_total - 100) >= 0.01 && <Badge tone="red">{r.weights_total}%</Badge>}</td>
                  {W.map(([k]) => <td key={k} className="num px-3 py-2.5 text-right">{+r[k]}%</td>)}
                  <td className="num px-3 py-2.5 text-right">{r.tasks.length}</td>
                  <td className="px-5 py-2.5 text-right"><Button variant="ghost" className="py-1.5" onClick={() => setEditing(editing === r.id ? null : r.id)}>Edit</Button></td>
                </tr>,
                editing === r.id ? <tr key={`e${r.id}`}><td colSpan={9} className="p-0"><RoleEditor role={r} tasks={tasks.data} onDone={() => setEditing(null)} /></td></tr> : null,
              ])}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div><h2 className="text-base font-bold">Tasks and points</h2>
            <p className="max-w-2xl text-xs text-slate-500">Click a cell to change it. Changing points also changes past days that used the task, as in the Excel sheet.
              Untick "In use" to hide a task from dropdowns while keeping its history.</p></div>
          <Input placeholder="Search tasks" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" aria-label="Search tasks" />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="mx-5 mt-4 grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 sm:grid-cols-[1fr_2fr_6rem_auto] dark:border-white/15">
          <Input placeholder="Type, e.g. Client Meeting" value={nt.type} onChange={(e) => setNt({ ...nt, type: e.target.value })} aria-label="New task type" />
          <Input placeholder="New task name" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} required aria-label="New task name" />
          <Input type="number" min={0} step={0.5} value={nt.points} onChange={(e) => setNt({ ...nt, points: e.target.value })} aria-label="New task points" className="num" />
          <Button type="submit" busy={add.isPending}><Plus className="size-4" /> Add task</Button>
        </form>
        {add.error && <div className="mx-5 mt-2"><Alert>{errorText(add.error)}</Alert></div>}
        <p className="mx-5 mt-2 text-xs text-slate-500">A new task appears in someone's dropdown once you tick it in their job role above.</p>
        <div className="mt-3 max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0"><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-[#0b1d37]">
              <th className="px-4 py-2">Type</th><th className="px-4 py-2">Task</th><th className="px-4 py-2 text-right">Points</th><th className="px-3 py-2 text-center" title="Logged as an event with evidence: it adds its points once a supervisor verifies it, and no hours">Event</th><th className="px-3 py-2 text-center">In use</th><th />
            </tr></thead>
            <tbody>{shown.map((t) => <TaskRow key={`${t.id}-${t.name}-${t.points}-${t.type}`} t={t} />)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
