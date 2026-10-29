import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { Alert, Badge, Button, Card } from "./ui";

interface ImportReport {
  dry_run: boolean;
  tasks: { created: string[]; updated: string[] };
  roles: { name: string; tasks: number; weights: number }[];
  sheets: { name: string; kind: "work" | "plan"; person: string; role: string | null; owner: string | null; created: boolean; days: number; hours: number; points: number; leave_only_days: number }[];
  kpi: { weeks: number; month_differs: number };
  warnings: string[];
}

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** Brings the existing Team Operation Sheet (.xlsx) in: people, targets, tasks, roles, every day and the weekly KPIs. */
export default function ImportWorkbook({ highlight }: { highlight?: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: async (check: boolean) => {
      const body = new FormData();
      body.append("file", file!);
      body.append("check", check ? "1" : "0");
      return (await api.post<ImportReport>("/team/import/", body)).data;
    },
    onSuccess: (r) => { if (!r.dry_run) qc.invalidateQueries(); },
  });
  const r = run.data;
  const checking = run.isPending && run.variables === true;
  const importing = run.isPending && run.variables === false;

  return (
    <Card className={highlight ? "border-brand-300 p-5 ring-2 ring-brand-100 dark:ring-brand-400/20" : "p-5"}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-10 place-items-center rounded-xl bg-leaf-500/10 text-leaf-600 [&>svg]:size-5"><FileSpreadsheet /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Import from the Excel sheet</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Choose the Team Operation Sheet (.xlsx). Everyone's tab, their planning tab, the targets, tasks, job roles and weekly KPIs come in,
            so earlier months and the year so far count straight away. Importing again later updates what's there; it never makes copies.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
              aria-label="Choose the Team Operation Sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); run.reset(); }} />
            <Button variant="secondary" onClick={() => input.current?.click()}><Upload className="size-4" /> {file ? "Choose another file" : "Choose file"}</Button>
            {file && <span className="max-w-xs truncate text-sm text-slate-600 dark:text-slate-300">{file.name}</span>}
            {file && <Button onClick={() => run.mutate(true)} busy={checking} disabled={run.isPending}>Check file</Button>}
            {r?.dry_run && <Button variant="secondary" className="border-leaf-500 text-leaf-600" onClick={() => run.mutate(false)}
              busy={importing} disabled={run.isPending}><CheckCircle2 className="size-4" /> Import now</Button>}
          </div>
        </div>
      </div>

      {run.error && <div className="mt-4"><Alert>{errorText(run.error)}</Alert></div>}
      {r && (
        <div className="mt-5">
          <Alert tone={r.dry_run ? "amber" : "green"}>
            {r.dry_run ? <><b>Checked, nothing saved yet.</b> This is what the import will bring in. Press <b>Import now</b> to save it.</>
              : <><b>Imported.</b> The sheets, dashboard and scores now include this data.</>}
          </Alert>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:bg-white/5">
                {["Sheet", "Person", "Job role", "Filled in by", "Days", "Hours", "Points"].map((h) => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {r.sheets.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100 dark:border-white/5">
                    <td className="px-4 py-2 font-semibold">{s.name} {s.kind === "plan" && <Badge>Plan</Badge>} {s.created && <Badge tone="brand">New</Badge>}</td>
                    <td className="px-4 py-2">{s.person}</td>
                    <td className="px-4 py-2">{s.role ?? <span className="text-amber-600">Not found</span>}</td>
                    <td className="px-4 py-2 text-xs">{s.owner ?? <span className="text-slate-400">Choose in the sheet's settings</span>}</td>
                    <td className="num px-4 py-2">{s.days}</td>
                    <td className="num px-4 py-2">{s.hours}</td>
                    <td className="num px-4 py-2">{nf.format(s.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {r.kpi.weeks} weekly KPI rows · {r.roles.length} job roles · {r.tasks.created.length} new tasks · {r.tasks.updated.length} tasks with changed points.
            People are linked to their sheet when their account name matches the name in CONFIG.
          </p>
          {r.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
        </div>
      )}
    </Card>
  );
}
