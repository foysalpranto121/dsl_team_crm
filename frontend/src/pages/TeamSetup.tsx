import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Pencil, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, errorText } from "../api/client";
import type { JobRole, Sheet, TeamSettings, User } from "../api/types";
import ImportWorkbook from "../components/ImportWorkbook";
import TasksRoles from "../components/TasksRoles";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from "../components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TARGETS = [
  ["target_hours", "Hours a week", "0.5"], ["target_points", "Points a month", "0.5"], ["target_leads", "Leads a month", "1"],
  ["target_opps", "Opportunities a month", "1"], ["target_clients", "Clients a month", "1"], ["target_revenue", "Revenue a month (BDT)", "1"],
] as const;
type SheetForm = Omit<Sheet, "id" | "owner_name" | "role_name" | "mine" | "updated_at" | "position" | "archived">;
const blank: SheetForm = { name: "", kind: "work", owner: null, person: "", role: null, start_date: null,
  target_hours: "0", target_points: "0", target_leads: "0", target_opps: "0", target_clients: "0", target_revenue: "0" };

function SheetEditor({ sheet, people, roles, onDone }: { sheet: Sheet | null; people: User[]; roles: JobRole[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<SheetForm>(sheet ? { ...blank, ...sheet } : blank);
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, person: f.person.trim(), name: f.name.trim(), start_date: f.start_date || null };
      return sheet ? (await api.patch(`/team/sheets/${sheet.id}/`, body)).data : (await api.post("/team/sheets/", body)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sheets"] }); qc.invalidateQueries({ queryKey: ["setup-sheets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["warnings"] }); onDone(); },
  });
  const set = <K extends keyof SheetForm>(k: K, v: SheetForm[K]) => setF({ ...f, [k]: v });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <form onSubmit={submit} className="grid gap-4 border-t border-slate-200 bg-slate-50/60 p-5 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/10 dark:bg-white/[0.02]">
      <Field label="Sheet name *" hint="Shown on the sheet tabs"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} /></Field>
      <Field label="Kind" hint="Plans don't count in scores">
        <Select value={f.kind} onChange={(e) => set("kind", e.target.value as SheetForm["kind"])}><option value="work">Work log</option><option value="plan">Plan</option></Select>
      </Field>
      <Field label="Filled in by" hint="Only this person (and admins) can edit it">
        <Select value={f.owner ?? ""} onChange={(e) => { const id = e.target.value ? Number(e.target.value) : null; const p = people.find((x) => x.id === id);
          setF({ ...f, owner: id, person: f.person || p?.name || "" }); }}>
          <option value="">Nobody (admins only)</option>
          {people.filter((p) => p.role !== "viewer").map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
        </Select>
      </Field>
      <Field label="Name on dashboards"><Input value={f.person} onChange={(e) => set("person", e.target.value)} maxLength={120} placeholder="e.g. Foysal Ahmed Pranto" /></Field>
      <Field label="Job role" hint="Decides the task list and score weights">
        <Select value={f.role ?? ""} onChange={(e) => set("role", e.target.value ? Number(e.target.value) : null)}>
          <option value="">No job role</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      <Field label="Counting starts" hint="Averages and scores count from this date">
        <Input type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} />
      </Field>
      {f.kind === "work" && TARGETS.map(([k, label, step]) => (
        <Field key={k} label={label}><Input type="number" min="0" step={step} value={f[k]} onChange={(e) => set(k, e.target.value)} required className="num" /></Field>
      ))}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" busy={save.isPending}>{sheet ? "Save sheet" : "Create sheet"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {save.error && <div className="w-full"><Alert>{errorText(save.error)}</Alert></div>}
      </div>
    </form>
  );
}

function RulesCard({ st }: { st: TeamSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState(st);
  const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return [st.timezone]; } })();
  const save = useMutation({
    mutationFn: async () => (await api.patch<TeamSettings>("/team/settings/", { name: f.name, timezone: f.timezone, lock_days: f.lock_days,
      week_start_dow: f.week_start_dow, weekend_days: f.weekend_days, count_weekend: f.count_weekend, currency: f.currency })).data,
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold">Team rules</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Team name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Time zone" hint="'Today' and the midnight lock use this zone">
          <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</Select>
        </Field>
        <Field label="Week starts on">
          <Select value={f.week_start_dow} onChange={(e) => setF({ ...f, week_start_dow: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
        </Field>
        <fieldset><legend className="label">Weekend days</legend>
          <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-white/10">
              <input type="checkbox" checked={f.weekend_days.includes(i)} onChange={(e) => setF({ ...f, weekend_days: e.target.checked ? [...f.weekend_days, i] : f.weekend_days.filter((x) => x !== i) })} />{d.slice(0, 3)}
            </label>))}</div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={f.lock_days} onChange={(e) => setF({ ...f, lock_days: e.target.checked })} />
          <span><b>Lock each day at midnight.</b> Members can only fill in today (plans: today and later). Admins can always correct.</span></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={f.count_weekend} onChange={(e) => setF({ ...f, count_weekend: e.target.checked })} />
          <span><b>Count hours logged on weekend days</b> in weekly and monthly totals (the original sheet counted them).</span></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" busy={save.isPending}>Save rules</Button>
          {save.isSuccess && <span className="text-sm text-leaf-600" role="status">Saved</span>}
        </div>
        {save.error && <div className="sm:col-span-2"><Alert>{errorText(save.error)}</Alert></div>}
      </form>
    </Card>
  );
}

export default function TeamSetup() {
  const qc = useQueryClient();
  const sheets = useQuery({ queryKey: ["setup-sheets"], queryFn: async () => (await api.get<Sheet[]>("/team/sheets/?archived=1")).data });
  const roles = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get<JobRole[]>("/team/roles/")).data });
  const people = useQuery({ queryKey: ["directory"], queryFn: async () => (await api.get<User[]>("/team/directory/")).data });
  const st = useQuery({ queryKey: ["team-settings"], queryFn: async () => (await api.get<TeamSettings>("/team/settings/")).data });
  const warnings = useQuery({ queryKey: ["warnings"], queryFn: async () => (await api.get<{ warnings: string[] }>("/team/warnings/")).data.warnings });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const archive = useMutation({
    mutationFn: async (s: Sheet) => (await api.patch(`/team/sheets/${s.id}/`, { archived: !s.archived })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["setup-sheets"] }); qc.invalidateQueries({ queryKey: ["sheets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });

  if ([sheets, roles, people, st].some((q) => q.isLoading)) return <Spinner />;
  const err = [sheets, roles, people, st].find((q) => q.error)?.error;
  if (err) return <Alert>{errorText(err)}</Alert>;

  return (
    <>
      <PageHeader title="Team setup" subtitle="Sheets, targets and team rules. Only admins see this page."
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> New sheet</Button>} />

      {!!warnings.data?.length && (
        <div className="mb-6"><Alert tone="amber">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Check these settings</div>
          <ul className="list-disc space-y-0.5 pl-5">{warnings.data.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert></div>
      )}

      {sheets.data!.length === 0 && <div className="mb-6"><ImportWorkbook highlight /></div>}

      <Card className="mb-6 overflow-hidden">
        <div className="px-5 pt-5"><h2 className="text-base font-bold">Sheets</h2>
          <p className="text-xs text-slate-500">One work log per person. Add a plan sheet if someone plans their week ahead.</p></div>
        {editing === "new" && <div className="mt-4"><SheetEditor sheet={null} people={people.data!} roles={roles.data!} onDone={() => setEditing(null)} /></div>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              {["Sheet", "Filled in by", "Job role", "Hours / week", "Points / month", "Leads", "Revenue", ""].map((h) => <th key={h} className="px-5 py-2.5 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {sheets.data!.length === 0 && editing !== "new" && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No sheets yet. Press <b>New sheet</b> to create the first one.</td></tr>}
              {sheets.data!.map((s) => [
                <tr key={s.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td className="px-5 py-3"><div className="font-semibold">{s.name}</div>
                    <div className="mt-0.5 flex gap-1">{s.kind === "plan" && <Badge>Plan</Badge>}{s.archived && <Badge tone="amber">Archived</Badge>}</div></td>
                  <td className="px-5 py-3">{s.owner_name || <span className="text-slate-400">Admins only</span>}<div className="text-xs text-slate-500">{s.person}</div></td>
                  <td className="px-5 py-3">{s.role_name || <span className="text-amber-600">None</span>}</td>
                  <td className="num px-5 py-3">{s.kind === "work" ? +s.target_hours : "—"}</td>
                  <td className="num px-5 py-3">{s.kind === "work" ? +s.target_points : "—"}</td>
                  <td className="num px-5 py-3">{s.kind === "work" ? +s.target_leads : "—"}</td>
                  <td className="num px-5 py-3">{s.kind === "work" ? (+s.target_revenue).toLocaleString("en-GB") : "—"}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" className="py-1.5" onClick={() => setEditing(editing === s.id ? null : s.id)}><Pencil className="size-4" /> Edit</Button>
                    <Button variant="ghost" className="py-1.5" onClick={() => archive.mutate(s)} title={s.archived ? "Bring back" : "Hide from the sheet list; data is kept"}>
                      <Archive className="size-4" /> {s.archived ? "Restore" : "Archive"}</Button>
                  </td>
                </tr>,
                editing === s.id ? <tr key={`e-${s.id}`}><td colSpan={8} className="p-0"><SheetEditor sheet={s} people={people.data!} roles={roles.data!} onDone={() => setEditing(null)} /></td></tr> : null,
              ])}
            </tbody>
          </table>
        </div>
      </Card>

      {sheets.data!.length > 0 && <div className="mb-6"><ImportWorkbook /></div>}

      <div className="mb-6"><RulesCard st={st.data!} /></div>

      <TasksRoles />
    </>
  );
}
