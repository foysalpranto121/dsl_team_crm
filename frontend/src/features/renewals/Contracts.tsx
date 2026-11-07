import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileSpreadsheet, FileUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "@/api/client";
import type { AdminUser } from "@/api/types";
import { Avatar } from "@/components/Brand";
import { DataTable } from "@/components/data/data-table";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Alert } from "@/components/ui";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { date, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterChips } from "./RenewalList";
import { KEY, KINDS, STAGE_TONE, TEMPLATE_CSV, endsText, stateOf, type Contract, type ContractStatus, type ImportResult, type Kind } from "./types";

/** Contracts for sold software, licences and AMCs (SRS FR-RN1). Admins add, edit and import them; everyone else reads. */

type Form = { client: string; product: string; kind: Kind; start_date: string | null; end_date: string | null; value: string; owner: number | null;
  terms: string; external_id: string; notes: string };
const BLANK: Form = { client: "", product: "", kind: "amc", start_date: null, end_date: null, value: "", owner: null, terms: "", external_id: "", notes: "" };
const NO_OWNER = "none";

function formOf(c: Contract): Form {
  return { client: c.client, product: c.product, kind: c.kind, start_date: c.start_date, end_date: c.end_date, value: String(Math.round(+c.value)),
    owner: c.owner, terms: c.terms, external_id: c.external_id, notes: c.notes };
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "col-span-2" : undefined}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

// ---------- add / edit / view ----------

function ContractSheet({ contract, open, isAdmin, onOpenChange, onOpenRenewal }: {
  contract: Contract | null; open: boolean; isAdmin: boolean; onOpenChange: (o: boolean) => void; onOpenRenewal: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(contract ? formOf(contract) : BLANK);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const people = useQuery({
    queryKey: ["admin-users", "approved"], enabled: isAdmin && open,
    queryFn: async () => (await api.get<AdminUser[]>("/admin/users/?status=approved")).data,
  });
  const owners = (people.data ?? []).filter((u) => u.role !== "viewer").map((u) => ({ value: String(u.id), label: u.name || u.email }));
  const bad = !f.client.trim() ? "Enter the client." : !f.product.trim() ? "Enter the product or service."
    : !f.start_date || !f.end_date ? "Choose the start and end dates." : f.end_date < f.start_date ? "The contract must end on or after it starts."
    : f.value === "" || +f.value < 0 ? "Enter the contract's value." : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, client: f.client.trim(), product: f.product.trim(), terms: f.terms.trim(), external_id: f.external_id.trim(), notes: f.notes.trim() };
      return contract ? (await api.patch<Contract>(`/renewals/contracts/${contract.id}/`, body)).data : (await api.post<Contract>("/renewals/contracts/", body)).data;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: KEY });
      onOpenChange(false);
      toast.success(contract ? "Contract saved" : "Contract added", {
        description: c.renewal?.stage === "open" && !contract?.renewal ? `It ends within the reminder window, so its renewal opened at once${c.owner_info ? ` for ${c.owner_info.name}` : ""}.` : undefined,
      });
    },
    onError: (e) => toast.error("Couldn't save the contract", { description: errorText(e) }),
  });
  const remove = async () => {
    try {
      await api.delete(`/renewals/contracts/${contract!.id}/`);
      qc.invalidateQueries({ queryKey: KEY });
      ["dashboard", "kpi-week", "performance"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
      toast.success("Contract deleted");
    } catch (e) {
      toast.error("Couldn't delete the contract", { description: errorText(e) });
      throw e;
    }
  };

  if (!isAdmin && contract) {
    const st = stateOf(contract.state);
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{contract.client}</SheetTitle>
            <SheetDescription>{contract.product} · {contract.kind_label}</SheetDescription>
            <div className="mt-2"><StatusPill status={st.status}>{st.text}</StatusPill></div>
          </SheetHeader>
          <SheetBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Fact label="Term">{date(contract.start_date, "short")} – {date(contract.end_date)}</Fact>
              <Fact label="Value">{money(+contract.value)}</Fact>
              <Fact label="Account owner">{contract.owner_info?.name ?? "Nobody yet"}</Fact>
              <Fact label="ID">{contract.external_id || "—"}</Fact>
              <Fact label="Renewal terms" wide>{contract.terms || "—"}</Fact>
              {contract.notes && <Fact label="Notes" wide><span className="whitespace-pre-line">{contract.notes}</span></Fact>}
            </dl>
            <p className="mt-6 text-xs text-muted-foreground">Only admins change contracts. Ask one if something here is wrong.</p>
          </SheetBody>
          {contract.renewal && (
            <SheetFooter><Button onClick={() => { onOpenChange(false); onOpenRenewal(contract.renewal!.id); }}>Open its renewal</Button></SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); if (!bad) save.mutate(); }}>
          <SheetHeader>
            <SheetTitle>{contract ? `Edit ${contract.client}` : "Add a contract"}</SheetTitle>
            <SheetDescription>Software, a licence or an AMC the client renews. Its renewal opens by itself before it ends.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <Field label="Client" required><Input value={f.client} maxLength={200} onChange={(e) => set("client", e.target.value)} required /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product or service" required><Input value={f.product} maxLength={120} onChange={(e) => set("product", e.target.value)} required /></Field>
              <Field label="Kind"><SimpleSelect value={f.kind} onValueChange={(v) => set("kind", v as Kind)} options={KINDS} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" required><DatePicker value={f.start_date} onChange={(v) => set("start_date", v)} /></Field>
              <Field label="Ends" required><DatePicker value={f.end_date} onChange={(v) => set("end_date", v)} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Value (BDT)" required hint="For this term.">
                <Input type="number" inputMode="numeric" min={0} step={1000} value={f.value} onChange={(e) => set("value", e.target.value)} required />
              </Field>
              <Field label="Account owner" hint="Works the renewal and gets the credit.">
                <SimpleSelect value={f.owner == null ? NO_OWNER : String(f.owner)} onValueChange={(v) => set("owner", v === NO_OWNER ? null : Number(v))}
                  options={[{ value: NO_OWNER, label: "Nobody yet" }, ...owners]} />
              </Field>
            </div>
            <Field label="Renewal terms" hint="e.g. Yearly, 10% increase, 30 days' notice.">
              <Input value={f.terms} maxLength={300} onChange={(e) => set("terms", e.target.value)} />
            </Field>
            <Field label="ID in Odoo or the old records" hint="Optional. Importing a file with the same ID updates this contract instead of adding a copy.">
              <Input value={f.external_id} maxLength={80} onChange={(e) => set("external_id", e.target.value)} />
            </Field>
            <Field label="Notes"><Textarea value={f.notes} maxLength={2000} rows={3} onChange={(e) => set("notes", e.target.value)} /></Field>
            {contract && contract.status !== "open" && (
              <Alert tone="blue">This term is closed ({contract.status_label.toLowerCase()}). Changes here correct the record; they don't reopen the renewal.</Alert>
            )}
          </SheetBody>
          <SheetFooter className="flex-wrap justify-between">
            {contract ? <Button type="button" variant="danger-ghost" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button> : <span />}
            <div className="flex gap-2">
              <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
              <Button type="submit" busy={save.isPending} disabled={!!bad}>{contract ? "Save changes" : "Add contract"}</Button>
            </div>
          </SheetFooter>
        </form>
        {contract && (
          <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} confirmLabel="Delete contract" title={`Delete ${contract.client} · ${contract.product}?`}
            onConfirm={remove}
            description={contract.renewal?.stage === "won" ? "Its renewal is deleted too, and the renewal revenue it brought stops counting in the Revenue KPI. This can't be undone."
              : "Its renewal is deleted too. This can't be undone."} />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- import from a CSV ----------

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "contracts-template.csv" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const send = async (f: File, dry: boolean) => {
    const body = new FormData();
    body.append("file", f);
    body.append("dry_run", dry ? "1" : "0");
    return (await api.post<ImportResult>("/renewals/contracts/import/", body)).data;
  };
  const check = useMutation({ mutationFn: (f: File) => send(f, true), onSuccess: setPreview, onError: () => setPreview(null) });
  const run = useMutation({
    mutationFn: () => send(file!, false),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      onOpenChange(false);
      toast.success("Contracts imported", { description: `${res.created} added · ${res.updated} updated${res.skipped ? ` · ${res.skipped} skipped` : ""}.` });
    },
    onError: (e) => toast.error("Couldn't import the file", { description: errorText(e) }),
  });
  const reset = () => { setFile(null); setPreview(null); check.reset(); if (input.current) input.current.value = ""; };
  const pick = (f: File | undefined) => { if (f) { setFile(f); check.mutate(f); } };
  const ready = preview ? preview.created + preview.updated : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Import contracts</DialogTitle>
          <DialogDescription>From a CSV file: your old records, or an export from Odoo. Nothing changes until you press Import.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => pick(e.target.files?.[0])} />
          {!preview ? (
            <>
              <button type="button" onClick={() => input.current?.click()} disabled={check.isPending}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center transition-colors hover:border-primary hover:bg-primary-soft/40 focus-visible:ring-2 focus-visible:ring-ring">
                <FileUp className="size-8 text-primary-text" aria-hidden />
                <span className="text-sm font-semibold">{check.isPending ? `Checking ${file?.name}…` : "Choose a CSV file"}</span>
                <span className="text-xs text-muted-foreground">Up to 2 MB and 5,000 rows</span>
              </button>
              {check.error && <Alert>{errorText(check.error)}</Alert>}
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium">The first row holds the column names. Needed: <b>client</b>, <b>product</b> and <b>end date</b>.</p>
                <p className="mt-1 text-muted-foreground">Also read: kind, start date, value, renewal terms, owner (email or name), ID, notes. Common names such as
                  Customer, Expiry date, Amount and Salesperson work too. Dates like 2026-12-31 or 31/12/2026.</p>
                <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={downloadTemplate}><Download /> Download a template</Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden /><span className="font-medium">{file?.name}</span>
                <Badge tone="success">{preview.created} new</Badge><Badge tone="info">{preview.updated} to update</Badge>
                {preview.skipped > 0 && <Badge tone="danger">{preview.skipped} with problems, skipped</Badge>}
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                    <tr>{["Row", "Client · product", "Ends", "Value", "Owner", "What happens"].map((h, i) => <th key={h} scope="col" className={cn("px-3 py-2 font-medium", i === 3 && "text-right")}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line} className="border-t border-border align-top">
                        <td className="num px-3 py-2 text-muted-foreground">{r.line}</td>
                        <td className="px-3 py-2"><div className="font-medium">{r.client || "—"}</div><div className="text-xs text-muted-foreground">{r.product || "—"}</div></td>
                        <td className="whitespace-nowrap px-3 py-2">{date(r.end_date)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right">{money(r.value)}</td>
                        <td className="px-3 py-2">{r.owner ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2">
                          <Badge tone={r.action === "error" ? "danger" : r.action === "create" ? "success" : "info"}>{r.action === "error" ? "Skipped" : r.action === "create" ? "Add" : "Update"}</Badge>
                          {[...r.errors, ...r.notes].map((m) => <div key={m} className={cn("mt-1 text-xs", r.errors.includes(m) ? "text-danger-text" : "text-muted-foreground")}>{m}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {preview && <Button type="button" variant="secondary" onClick={reset}>Choose another file</Button>}
          <Button type="button" busy={run.isPending} disabled={!ready} onClick={() => run.mutate()}>
            {preview ? `Import ${ready} ${ready === 1 ? "contract" : "contracts"}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- the table ----------

type Show = "all" | ContractStatus;
const SHOWS: { key: Show; label: string }[] = [{ key: "all", label: "All" }, { key: "open", label: "Open" }, { key: "renewed", label: "Renewed" }, { key: "lost", label: "Not renewed" }];

export function Contracts({ isAdmin, seesAll, onOpenRenewal, startAdding }: {
  isAdmin: boolean; seesAll: boolean; onOpenRenewal: (id: number) => void; startAdding?: boolean;
}) {
  const [show, setShow] = useState<Show>("open");
  const [editing, setEditing] = useState<{ contract: Contract | null } | null>(startAdding ? { contract: null } : null);
  const [importing, setImporting] = useState(false);
  const q = useQuery({ queryKey: [...KEY, "contracts"], queryFn: async () => (await api.get<Contract[]>("/renewals/contracts/")).data });
  const all = q.data ?? [];
  const rows = useMemo(() => all.filter((c) => show === "all" || c.status === show), [all, show]);

  const columns = useMemo<ColumnDef<Contract, any>[]>(() => [
    { accessorKey: "client", header: "Client", enableHiding: false,
      cell: (c) => <div className="min-w-0"><div className="truncate font-medium text-foreground">{c.row.original.client}</div>
        <div className="truncate text-xs text-muted-foreground">{c.row.original.product}</div></div> },
    { accessorKey: "kind_label", header: "Kind" },
    { accessorKey: "end_date", header: "Term", cell: (c) => { const x = c.row.original; return (
      <div className="whitespace-nowrap"><div>{date(x.start_date, "short")} – {date(x.end_date)}</div>
        {x.status === "open" && <div className="text-xs text-muted-foreground">{endsText(x.days_left)}</div>}</div>); } },
    { id: "value", accessorFn: (c) => +c.value, header: "Value", meta: { numeric: true }, cell: (c) => money(c.getValue()) },
    { id: "state", accessorFn: (c) => stateOf(c.state).text, header: "Status", cell: (c) => { const x = c.row.original, st = stateOf(x.state); return (
      <div className="flex flex-col items-start gap-1"><StatusPill status={st.status}>{st.text}</StatusPill>
        {x.renewal && x.status === "open" && <Badge tone={STAGE_TONE[x.renewal.stage]}>Renewal: {x.renewal.stage_label}</Badge>}</div>); } },
    ...(seesAll ? [{ id: "owner", accessorFn: (c: Contract) => c.owner_info?.name ?? "", header: "Owner",
      cell: (c: { row: { original: Contract } }) => { const o = c.row.original.owner_info; return o
        ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><Avatar name={o.name} src={o.photo} size="xs" />{o.name}</span>
        : <span className="text-muted-foreground">No owner</span>; } } as ColumnDef<Contract, any>] : []),
    { accessorKey: "external_id", header: "ID", meta: { label: "ID in Odoo or old records" }, cell: (c) => c.getValue() || <span className="text-subtle-foreground">—</span> },
  ], [seesAll]);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <DataTable label="Contracts" columns={columns} data={rows} getRowId={(c) => String(c.id)} loading={q.isLoading} pageSize={25}
        onRowClick={(c) => setEditing({ contract: c })} searchPlaceholder="Search contracts…" exportName="contracts"
        initialSorting={[{ id: "end_date", desc: false }]}
        toolbar={<div className="flex flex-wrap items-center gap-2">
          <FilterChips label="Show" value={show} onChange={setShow} options={SHOWS.map((s) => ({ ...s, count: q.data ? all.filter((c) => s.key === "all" || c.status === s.key).length : undefined }))} />
          {isAdmin && <>
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><FileUp /> Import CSV</Button>
            <Button size="sm" onClick={() => setEditing({ contract: null })}><Plus /> Add contract</Button>
          </>}
        </div>}
        empty={all.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet />} title={isAdmin ? "Add the contracts you renew" : "No contracts yet"}
            action={isAdmin && <Button onClick={() => setImporting(true)}><FileUp /> Import a CSV</Button>}
            secondary={isAdmin && <Button variant="secondary" onClick={() => setEditing({ contract: null })}><Plus /> Add one by hand</Button>}>
            {isAdmin ? "Software, licences and AMCs with an end date. TOS opens each renewal before it ends and reminds the owner." : seesAll
              ? "Admins haven't added any contracts yet." : "No contracts are assigned to you yet. Admins add them."}
          </EmptyState>
        ) : <EmptyState compact icon={<FileSpreadsheet />} title="Nothing here">No contracts match this filter.</EmptyState>} />
      {editing && (
        <ContractSheet key={editing.contract?.updated_at ?? "new"} contract={editing.contract} open isAdmin={isAdmin}
          onOpenChange={(o) => { if (!o) setEditing(null); }} onOpenRenewal={onOpenRenewal} />
      )}
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
