import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Download, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, downloadFile, errorText } from "../api/client";
import type { Backup, JobRole, Sheet, TeamSettings, User } from "../api/types";
import ImportWorkbook from "../components/ImportWorkbook";
import TasksRoles from "../components/TasksRoles";
import { PolicyAndFeatures } from "../features/setup/PolicyAndFeatures";
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
      <Field label="Name *" hint="Shown in the Daily log and on dashboards"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} /></Field>
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
        <Button type="submit" busy={save.isPending}>{sheet ? "Save daily log" : "Create daily log"}</Button>
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
          <span><b>Count hours logged on weekend days</b> in weekly and monthly totals (the original Excel workbook counted them).</span></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" busy={save.isPending}>Save rules</Button>
          {save.isSuccess && <span className="text-sm text-leaf-600" role="status">Saved</span>}
        </div>
        {save.error && <div className="sm:col-span-2"><Alert>{errorText(save.error)}</Alert></div>}
      </form>
    </Card>
  );
}

/** Automatic and manual copies of the team data, with download and restore. Restoring backs up the current data first. */
function BackupsCard({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const backups = useQuery({ queryKey: ["snapshots"], queryFn: async () => (await api.get<Backup[]>("/team/snapshots/")).data });
  const [restoring, setRestoring] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["snapshots"] });
  const take = useMutation({ mutationFn: async () => (await api.post("/team/snapshots/")).data, onSuccess: refresh });
  const restore = useMutation({
    mutationFn: async (name: string) => (await api.post(`/team/snapshots/${name}/restore/`, { confirm: text })).data,
    onSuccess: () => { setRestoring(null); setText(""); refresh(); onRestored(); },
  });
  const download = async (name: string) => {
    setDownloadError("");
    try { await downloadFile(`/team/snapshots/${name}/`, name); } catch (e) { setDownloadError(errorText(e)); }
  };
  const problem = take.error || restore.error ? errorText(take.error || restore.error) : downloadError;
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div><h2 className="text-base font-bold">Backups</h2>
          <p className="max-w-3xl text-xs text-slate-500">A copy of all daily logs, days and weekly results is saved automatically before a daily log is deleted, all team data is deleted, or a workbook replaces the data. The newest 30 are kept.</p></div>
        <Button variant="secondary" onClick={() => take.mutate()} busy={take.isPending}><Plus className="size-4" /> Back up now</Button>
      </div>
      {problem && <div className="px-5 pt-3"><Alert>{problem}</Alert></div>}
      {backups.data?.length === 0 && <p className="px-5 py-5 text-sm text-slate-500">No backups yet. One is saved the next time you delete a daily log, delete all team data, or replace the data from a workbook.</p>}
      {!!backups.data?.length && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              {["Saved", "Why", "Contains", ""].map((h) => <th key={h} className="px-5 py-2.5 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {backups.data.map((b) => (
                <tr key={b.name} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td className="whitespace-nowrap px-5 py-3">{new Date(b.created).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-5 py-3">{b.reason}</td>
                  <td className="num px-5 py-3">{b.sheets} daily logs · {b.days} days · {b.kpi_weeks} weeks</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {restoring === b.name
                      ? <span className="inline-flex flex-wrap items-center justify-end gap-2 text-xs">Type RESTORE to replace all team data with this backup:
                          <Input value={text} onChange={(e) => setText(e.target.value)} className="w-36" aria-label="Type RESTORE to confirm" />
                          <Button variant="danger" className="py-1 text-xs" disabled={text !== "RESTORE"} busy={restore.isPending} onClick={() => restore.mutate(b.name)}>Restore</Button>
                          <Button variant="ghost" className="py-1 text-xs" onClick={() => { setRestoring(null); setText(""); }}>Cancel</Button></span>
                      : <>
                          <Button variant="ghost" className="py-1.5" onClick={() => download(b.name)} title="Download as a JSON file"><Download className="size-4" /> Download</Button>
                          <Button variant="ghost" className="py-1.5" onClick={() => { setRestoring(b.name); setText(""); }}><RotateCcw className="size-4" /> Restore…</Button>
                        </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [resetText, setResetText] = useState("");
  const refreshAll = () => ["setup-sheets", "sheets", "dashboard", "performance", "kpi-week", "leaderboard", "warnings", "activity"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const del = useMutation({ mutationFn: async (id: number) => api.delete(`/team/sheets/${id}/`), onSuccess: () => { setConfirmDel(null); refreshAll(); } });
  const reset = useMutation({ mutationFn: async () => (await api.post<{ sheets: number; days: number; kpi_weeks: number; backup: string }>("/team/reset/", { confirm: resetText })).data,
    onSuccess: () => { setResetText(""); refreshAll(); } });
  const archive = useMutation({
    mutationFn: async (s: Sheet) => (await api.patch(`/team/sheets/${s.id}/`, { archived: !s.archived })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["setup-sheets"] }); qc.invalidateQueries({ queryKey: ["sheets"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });

  if ([sheets, roles, people, st].some((q) => q.isLoading)) return <Spinner />;
  const err = [sheets, roles, people, st].find((q) => q.error)?.error;
  if (err) return <Alert>{errorText(err)}</Alert>;

  return (
    <>
      <PageHeader title="Team setup" subtitle="Daily logs, targets and team rules. Only admins see this page."
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> New daily log</Button>} />

      {!!warnings.data?.length && (
        <div className="mb-6"><Alert tone="amber">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Check these settings</div>
          <ul className="list-disc space-y-0.5 pl-5">{warnings.data.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert></div>
      )}

      {sheets.data!.length === 0 && <div className="mb-6"><ImportWorkbook highlight /></div>}

      <Card className="mb-6 overflow-hidden">
        <div className="px-5 pt-5"><h2 className="text-base font-bold">Daily logs</h2>
          <p className="text-xs text-slate-500">One work log per person. Add a plan if someone plans their week ahead.</p></div>
        {editing === "new" && <div className="mt-4"><SheetEditor sheet={null} people={people.data!} roles={roles.data!} onDone={() => setEditing(null)} /></div>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              {["Daily log", "Filled in by", "Job role", "Hours / week", "Points / month", "Leads", "Revenue", ""].map((h) => <th key={h} className="px-5 py-2.5 font-semibold">{h}</th>)}
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
                    <Button variant="ghost" className="py-1.5" onClick={() => archive.mutate(s)} title={s.archived ? "Bring back" : "Hide from the list; data is kept"}>
                      <Archive className="size-4" /> {s.archived ? "Restore" : "Archive"}</Button>
                    {confirmDel === s.id
                      ? <span className="ml-1 inline-flex items-center gap-1 text-xs">Delete with all its days? A backup is saved first.
                          <Button variant="danger" className="py-1 text-xs" onClick={() => del.mutate(s.id)} busy={del.isPending}>Delete</Button>
                          <Button variant="ghost" className="py-1 text-xs" onClick={() => setConfirmDel(null)}>Keep</Button></span>
                      : <Button variant="ghost" className="py-1.5 text-accent-600" onClick={() => setConfirmDel(s.id)} title="Delete this daily log and all its days and KPIs"><Trash2 className="size-4" /> Delete</Button>}
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
      <div className="mb-6"><PolicyAndFeatures st={st.data!} /></div>

      <TasksRoles />

      <BackupsCard onRestored={refreshAll} />

      <Card className="mt-6 border-accent-300 p-5 dark:border-accent-500/40">
        <h2 className="flex items-center gap-2 text-base font-bold text-accent-600"><AlertTriangle className="size-5" /> Danger zone: delete all team data</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Deletes <b>every sheet with all its days and weekly KPIs</b>, so you can start again or import a new workbook. People's accounts and profiles,
          tasks, job roles, team rules and everyone's private tracker are kept. This can't be undone. To replace the data in one step instead,
          tick <b>Replace everything</b> in "Import from the Excel sheet" above. A backup is saved first, listed under Backups above.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder='Type DELETE to confirm' className="w-56" aria-label="Type DELETE to confirm" />
          <Button variant="danger" disabled={resetText !== "DELETE"} busy={reset.isPending} onClick={() => reset.mutate()}><Trash2 className="size-4" /> Delete all team data</Button>
          {reset.data && <Alert tone="green">Deleted {reset.data.sheets} daily logs, {reset.data.days} days and {reset.data.kpi_weeks} KPI weeks. Backup saved: {reset.data.backup}.</Alert>}
          {(reset.error || del.error) && <Alert>{errorText(reset.error || del.error)}</Alert>}
        </div>
      </Card>
    </>
  );
}
