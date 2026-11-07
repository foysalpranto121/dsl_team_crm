import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, CircleDashed, ListTodo, MoreHorizontal, Plus, Repeat, RotateCcw, Trash2, UserCheck, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, errorText } from "@/api/client";
import { todayQuery } from "@/api/queries";
import type { Sheet, Task } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form-controls";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { addDays, fmt, ptsText } from "../log/util";

/**
 * My Tasks (SRS v0.5 §5.6): a personal to-do list with dates. Quick add with natural dates (FR-MT1); Today, Upcoming
 * (drag to reschedule), Overdue and Done (FR-MT2); open, done or dropped, repeating (FR-MT3); tasks assigned by a
 * supervisor (FR-MT4); a task with an Activity Type can be logged as one hour (FR-MT5). Personal titles are private;
 * supervisors see counts and the tasks they assigned (FR-MT6).
 */

interface MyTask {
  id: number; title: string; due_date: string; due_time: string | null; priority: "low" | "normal" | "high"; client: number | null; client_name: string | null;
  activity: number | null; activity_name: string | null; activity_points: number | null; status: "open" | "done" | "dropped"; status_label: string;
  drop_reason: string; repeat: "none" | "daily" | "weekly"; assigned_by_name: string | null; done_at: string | null; logged_day: string | null;
  logged_hour: number | null; overdue: boolean;
}
interface TeamTasks {
  today: string; people: { id: number; name: string; open: number; overdue: number; done_week: number }[];
  assigned: { id: number; title: string; person: string; due_date: string; status: string; status_label: string; assigned_by: string | null; overdue: boolean; logged: boolean }[];
}
type View = "today" | "upcoming" | "overdue" | "done" | "team";
const KEY = ["my-tasks"];

function dueText(t: MyTask, today: string) {
  if (t.due_date === today) return "Today";
  if (t.due_date === addDays(today, 1)) return "Tomorrow";
  const days = Math.round((Date.parse(today) - Date.parse(t.due_date)) / 864e5);
  return days > 0 ? `${days} ${days === 1 ? "day" : "days"} overdue` : fmt(t.due_date, { weekday: "short", day: "numeric", month: "short" });
}

function useTaskActions() {
  const qc = useQueryClient();
  const refresh = () => [KEY, ["entries"], ["dashboard"], ["playbook"]].forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const log = useMutation({
    mutationFn: async ({ id, hour }: { id: number; hour: number }) => (await api.post(`/tasks/items/${id}/log/`, { hour })).data,
    onSuccess: (_, v) => { refresh(); toast.success(`Logged in hour ${v.hour + 1}`, { description: "It's in My Day now." }); },
    onError: (e) => toast.error("Couldn't log it", { description: errorText(e) }),
  });
  const done = useMutation({
    mutationFn: async (t: MyTask) => (await api.post<MyTask & { free_hour: number | null; next_task: number | null }>(`/tasks/items/${t.id}/done/`)).data,
    onSuccess: (r) => {
      refresh();
      if (r.free_hour != null) {
        toast.success(`Done: ${r.title}`, { description: `Log it as an hour of ${r.activity_name}?${r.assigned_by_name ? " Assigned tasks count straight away." : ""}`,
          action: { label: `Log in hour ${r.free_hour + 1}`, onClick: () => log.mutate({ id: r.id, hour: r.free_hour! }) }, duration: 10000 });
      } else toast.success(`Done: ${r.title}`, { description: r.next_task ? "It repeats: the next one is on your list." : undefined });
    },
    onError: (e) => toast.error("Couldn't finish the task", { description: errorText(e) }),
  });
  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => (await api.patch(`/tasks/items/${id}/`, body)).data,
    onSuccess: refresh, onError: (e) => toast.error("Couldn't change the task", { description: errorText(e) }),
  });
  const act = useMutation({
    mutationFn: async ({ id, verb, body }: { id: number; verb: "reopen" | "drop" | "delete"; body?: object }) =>
      verb === "delete" ? api.delete(`/tasks/items/${id}/`) : api.post(`/tasks/items/${id}/${verb}/`, body ?? {}),
    onSuccess: refresh, onError: (e) => toast.error("Couldn't change the task", { description: errorText(e) }),
  });
  return { done, patch, act, log };
}

function TaskRow({ t, today, onDrop }: { t: MyTask; today: string; onDrop: (t: MyTask) => void }) {
  const { done, patch, act } = useTaskActions();
  const [picking, setPicking] = useState(false);
  const open = t.status === "open";
  return (
    <li draggable={open} onDragStart={(e) => { e.dataTransfer.setData("text/task", String(t.id)); e.dataTransfer.effectAllowed = "move"; }}
      className={cn("group flex items-start gap-3 px-4 py-3", open && "cursor-grab active:cursor-grabbing")}>
      {open ? <Checkbox className="mt-0.5" aria-label={`Done: ${t.title}`} checked={false} disabled={done.isPending} onCheckedChange={() => done.mutate(t)} />
        : t.status === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Dropped" />}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", !open && "text-muted-foreground line-through decoration-1")}>{t.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {open && <span className={cn("font-medium", t.overdue ? "text-danger-text" : t.due_date === today ? "text-primary-text" : "")}>{dueText(t, today)}{t.due_time && ` · ${t.due_time.slice(0, 5)}`}</span>}
          {!open && t.drop_reason && <span>Dropped: {t.drop_reason}</span>}
          {t.priority === "high" && <Badge tone="warning">High</Badge>}
          {t.activity_name && <Badge tone="outline">{t.activity_name} · {ptsText(t.activity_points ?? 0)}</Badge>}
          {t.client_name && <span>· {t.client_name}</span>}
          {t.assigned_by_name && <Badge tone="info"><UserCheck aria-hidden /> Assigned by {t.assigned_by_name}</Badge>}
          {t.repeat !== "none" && <span className="inline-flex items-center gap-1"><Repeat className="size-3" aria-hidden />{t.repeat === "daily" ? "Every working day" : "Every week"}</span>}
          {t.logged_day && <Badge tone="success">Logged in hour {t.logged_hour! + 1}</Badge>}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${t.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {open ? <>
            <DropdownMenuItem onSelect={() => patch.mutate({ id: t.id, body: { due_date: addDays(today, 1) } })}><CalendarDays /> Tomorrow</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch.mutate({ id: t.id, body: { due_date: addDays(today, 7) } })}><CalendarDays /> Next week</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicking(true)}><CalendarDays /> Pick a date…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDrop(t)}><CircleDashed /> Drop…</DropdownMenuItem>
          </> : <DropdownMenuItem onSelect={() => act.mutate({ id: t.id, verb: "reopen" })}><RotateCcw /> Reopen</DropdownMenuItem>}
          {!t.assigned_by_name && <DropdownMenuItem tone="danger" onSelect={() => act.mutate({ id: t.id, verb: "delete" })}><Trash2 /> Delete</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Move “{t.title}”</DialogTitle><DialogDescription>Choose the new date.</DialogDescription></DialogHeader>
          <DialogBody><DatePicker value={t.due_date} aria-label="New date" onChange={(v) => { if (v) { patch.mutate({ id: t.id, body: { due_date: v } }); setPicking(false); } }} /></DialogBody>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function QuickAdd({ tasks, focus }: { tasks: Task[]; focus: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [priority, setPriority] = useState("normal");
  const [activity, setActivity] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, [focus]);
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const id = window.setTimeout(() => setDebounced(when), 250); return () => window.clearTimeout(id); }, [when]);
  const preview = useQuery({ queryKey: ["task-when", debounced], queryFn: async () => (await api.get<{ date: string }>(`/tasks/when/?text=${encodeURIComponent(debounced)}`)).data, retry: false });
  const add = useMutation({
    mutationFn: async () => (await api.post("/tasks/items/", { title, due: when, priority, activity: activity ? Number(activity) : null })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); setTitle(""); setWhen(""); setActivity(null); setPriority("normal"); ref.current?.focus(); },
    onError: (e) => toast.error("Couldn't add the task", { description: errorText(e) }),
  });
  return (
    <form className="card p-4" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="New task" className="min-w-56 flex-[3]"><Input ref={ref} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send the proposal to BRAC" /></Field>
        <Field label="When" className="min-w-36 flex-1" hint={preview.data ? fmt(preview.data.date, { weekday: "short", day: "numeric", month: "short" }) : preview.isError ? "Try today, tomorrow, Sun or 15 Nov" : " "}>
          <Input value={when} maxLength={40} onChange={(e) => setWhen(e.target.value)} placeholder="today" aria-invalid={preview.isError || undefined} />
        </Field>
        <Field label="Priority" className="w-32"><SimpleSelect value={priority} onValueChange={setPriority} aria-label="Priority"
          options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }]} /></Field>
        <Field label="Counts as" className="min-w-52 flex-[2]" hint="Optional: log it as an hour of this activity.">
          <Combobox value={activity} onChange={setActivity} aria-label="Activity type" placeholder="No activity" searchPlaceholder="Search activities…" clearable
            options={tasks.filter((t) => t.active).map((t) => ({ value: String(t.id), label: t.name, hint: ptsText(+t.points), group: t.type || "Tasks" }))} />
        </Field>
        <Button type="submit" busy={add.isPending} disabled={!title.trim() || preview.isError} className="mb-[22px]"><Plus /> Add</Button>
      </div>
    </form>
  );
}

function DropDialog({ task, onClose }: { task: MyTask | null; onClose: () => void }) {
  const { act } = useTaskActions();
  const [reason, setReason] = useState("");
  return (
    <Dialog open={!!task} onOpenChange={(o) => { if (!o) { onClose(); setReason(""); } }}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (task) act.mutate({ id: task.id, verb: "drop", body: { reason } }, { onSuccess: () => { onClose(); setReason(""); } }); }}>
          <DialogHeader><DialogTitle>Drop “{task?.title}”</DialogTitle><DialogDescription>{task?.assigned_by_name ? `${task.assigned_by_name} assigned it, so say why.` : "Optional: say why."}</DialogDescription></DialogHeader>
          <DialogBody><Field label="Reason"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} required={!!task?.assigned_by_name} /></Field></DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="danger" busy={act.isPending}>Drop task</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ open, onOpenChange, tasks }: { open: boolean; onOpenChange: (o: boolean) => void; tasks: Task[] }) {
  const qc = useQueryClient();
  const sheets = useQuery({ queryKey: ["sheets"], queryFn: async () => (await api.get<Sheet[]>("/team/sheets/")).data, enabled: open });
  const people = (sheets.data ?? []).filter((s) => s.kind === "work" && !s.archived && s.owner && !s.mine).map((s) => ({ value: String(s.owner), label: s.person || s.owner_name || s.name }));
  const [f, setF] = useState({ person: null as string | null, title: "", due: "", activity: null as string | null });
  const save = useMutation({
    mutationFn: async () => (await api.post("/tasks/assign/", { person: Number(f.person), title: f.title, due: f.due, activity: f.activity ? Number(f.activity) : null })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-tasks-team"] }); onOpenChange(false); setF({ person: null, title: "", due: "", activity: null }); toast.success("Task assigned", { description: "It's on their list, marked as assigned by you." }); },
    onError: (e) => toast.error("Couldn't assign the task", { description: errorText(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); if (f.person && f.title.trim()) save.mutate(); }}>
          <DialogHeader><DialogTitle>Assign a task</DialogTitle><DialogDescription>It shows on their list as assigned by you; its hour counts without approval.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Person" required><Combobox value={f.person} onChange={(v) => setF({ ...f, person: v })} options={people} aria-label="Person" placeholder="Choose someone" /></Field>
            <Field label="Task" required><Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Visit Walton Group" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="When"><Input value={f.due} maxLength={40} onChange={(e) => setF({ ...f, due: e.target.value })} placeholder="today" /></Field>
              <Field label="Activity type"><Combobox value={f.activity} onChange={(v) => setF({ ...f, activity: v })} aria-label="Activity type" placeholder="None" clearable
                options={tasks.filter((t) => t.active).map((t) => ({ value: String(t.id), label: t.name, hint: ptsText(+t.points), group: t.type || "Tasks" }))} /></Field>
            </div>
          </DialogBody>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" busy={save.isPending} disabled={!f.person || !f.title.trim()}>Assign</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamPanel() {
  const q = useQuery({ queryKey: ["my-tasks-team"], queryFn: async () => (await api.get<TeamTasks>("/tasks/team/")).data });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card overflow-hidden" aria-labelledby="team-counts">
        <h2 id="team-counts" className="border-b border-border px-5 py-3 text-sm font-semibold">Everyone's tasks <span className="font-normal text-muted-foreground">· counts only; personal titles stay private</span></h2>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-medium">Person</th><th className="px-2 py-2 text-right font-medium">Open</th>
          <th className="px-2 py-2 text-right font-medium">Overdue</th><th className="px-5 py-2 text-right font-medium">Done this week</th></tr></thead>
          <tbody>{q.data.people.map((p) => <tr key={p.id} className="border-t border-border"><td className="px-5 py-2">{p.name}</td><td className="px-2 py-2 text-right">{p.open}</td>
            <td className={cn("px-2 py-2 text-right", p.overdue > 0 && "font-medium text-danger-text")}>{p.overdue}</td><td className="px-5 py-2 text-right">{p.done_week}</td></tr>)}</tbody></table>
      </section>
      <section className="card overflow-hidden" aria-labelledby="team-assigned">
        <h2 id="team-assigned" className="border-b border-border px-5 py-3 text-sm font-semibold">Assigned tasks</h2>
        {q.data.assigned.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No tasks assigned yet.</p> : (
          <ul className="divide-y divide-border">{q.data.assigned.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
              <span className="text-muted-foreground">{a.person}</span><span className={cn("text-xs", a.overdue ? "font-medium text-danger-text" : "text-muted-foreground")}>{fmt(a.due_date, { day: "numeric", month: "short" })}</span>
              <Badge tone={a.status === "done" ? "success" : a.status === "dropped" ? "neutral" : a.overdue ? "danger" : "info"}>{a.overdue ? "Overdue" : a.status_label}</Badge></li>))}</ul>
        )}
      </section>
    </div>
  );
}

export default function MyTasks() {
  const { user } = useAuth();
  const approver = user?.role === "admin" || user?.role === "supervisor";
  const [params, setParams] = useSearchParams();
  const view = (["today", "upcoming", "overdue", "done", "team"].includes(params.get("view") ?? "") ? params.get("view") : "today") as View;
  const tasksQ = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const all = useQuery({ queryKey: [...KEY, "open"], queryFn: async () => (await api.get<MyTask[]>("/tasks/items/?view=open")).data });
  const doneQ = useQuery({ queryKey: [...KEY, "done"], queryFn: async () => (await api.get<MyTask[]>("/tasks/items/?view=done")).data, enabled: view === "done" });
  const today = useQuery(todayQuery).data?.today ?? "";
  const [dropping, setDropping] = useState<MyTask | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const { patch } = useTaskActions();
  const open = useMemo(() => (today ? all.data ?? [] : []), [all.data, today]);
  const lists = useMemo(() => ({
    today: open.filter((t) => t.due_date === today), upcoming: open.filter((t) => t.due_date > today), overdue: open.filter((t) => t.due_date < today),
  }), [open, today]);
  const setView = (v: View) => { const p = new URLSearchParams(params); p.set("view", v); p.delete("new"); setParams(p, { replace: true }); };

  const groups = useMemo(() => {
    if (!today) return [];
    const m = new Map<string, MyTask[]>();
    lists.upcoming.forEach((t) => m.set(t.due_date, [...(m.get(t.due_date) ?? []), t]));
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));   // the next 7 days are always drop targets
    [...m.keys()].forEach((d) => { if (!days.includes(d)) days.push(d); });
    return days.sort().map((d) => [d, m.get(d) ?? []] as const);
  }, [lists.upcoming, today]);
  const drop = (day: string) => (e: React.DragEvent) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/task")); if (id) patch.mutate({ id, body: { due_date: day } }); };

  const list = (items: MyTask[], empty: string) => items.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p>
    : <ul className="divide-y divide-border">{items.map((t) => <TaskRow key={t.id} t={t} today={today} onDrop={setDropping} />)}</ul>;

  return (
    <>
      <PageHeader title="My Tasks" subtitle="Your to-do list. A task with an activity type can be logged as one hour of work."
        actions={approver && <Button variant="secondary" onClick={() => setAssigning(true)}><Users /> Assign a task</Button>} />
      <QuickAdd tasks={tasksQ.data ?? []} focus={params.get("new") === "1"} />
      <div className="my-5">
        <Segmented label="Show" value={view} onChange={setView} options={[
          { key: "today", label: "Today", count: lists.today.length }, { key: "upcoming", label: "Upcoming", count: lists.upcoming.length },
          { key: "overdue", label: "Overdue", count: lists.overdue.length }, { key: "done", label: "Done" },
          ...(approver ? [{ key: "team" as const, label: "Team" }] : [])]} />
      </div>
      {all.error ? <ErrorState error={all.error} onRetry={() => all.refetch()} /> : !all.data || !today ? <Skeleton className="h-64 w-full" /> : view === "team" ? <TeamPanel /> : (
        <section className="card overflow-hidden" aria-label={`${view} tasks`}>
          {view === "today" && list(lists.today, "Nothing due today. Add a task above, or enjoy the space.")}
          {view === "overdue" && list(lists.overdue, "Nothing overdue. Well done.")}
          {view === "done" && (doneQ.data ? list(doneQ.data, "Nothing finished in the last 60 days yet.") : <Skeleton className="m-4 h-24" />)}
          {view === "upcoming" && (
            <div>
              <p className="border-b border-border px-5 py-2.5 text-xs text-muted-foreground">Drag a task onto another day to move it.</p>
              {groups.map(([d, items]) => (
                <div key={d} onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver((o) => (o === d ? null : o))} onDrop={drop(d)}
                  className={cn("border-b border-border last:border-0", over === d && "bg-primary-soft/60")}>
                  <h3 className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d === addDays(today, 1) ? "Tomorrow" : fmt(d, { weekday: "long", day: "numeric", month: "short" })}</h3>
                  {items.length ? <ul className="divide-y divide-border">{items.map((t) => <TaskRow key={t.id} t={t} today={today} onDrop={setDropping} />)}</ul>
                    : <p className="px-5 pb-3 text-xs text-subtle-foreground">—</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {all.data && open.length === 0 && view !== "team" && view !== "done" && (
        <div className="mt-5 card"><EmptyState icon={<ListTodo />} title="Your list is empty">Add what you need to do, with a date like “tomorrow” or “Sun”.</EmptyState></div>
      )}
      <DropDialog task={dropping} onClose={() => setDropping(null)} />
      {approver && <AssignDialog open={assigning} onOpenChange={setAssigning} tasks={tasksQ.data ?? []} />}
    </>
  );
}
