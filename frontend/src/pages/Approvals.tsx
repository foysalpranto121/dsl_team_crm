import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api/client";
import type { AdminUser, Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Brand";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Spinner } from "../components/ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "member", label: "Member", hint: "Fills in their own sheet" },
  { value: "admin", label: "Admin", hint: "Manages people, sheets and targets" },
  { value: "viewer", label: "Viewer", hint: "Can only look" },
];

function Request({ u, onApproved }: { u: AdminUser; onApproved: (msg: string) => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>("member");
  const decide = useMutation({
    mutationFn: async (action: "approve" | "reject") => (await api.post<AdminUser & { linked_sheets?: string[] }>(`/admin/users/${u.id}/${action}/`, action === "approve" ? { role } : {})).data,
    onSuccess: (data, action) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["sheets"] });
      const who = u.name || u.email;
      if (action === "approve") onApproved(data.linked_sheets?.length
        ? `${who} is approved and linked to: ${data.linked_sheets.join(", ")}.`
        : `${who} is approved. No sheet carries the name "${u.name}" — link one in Team setup → Edit → Filled in by.`);
    },
  });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={u.name || u.email} src={u.profile.photo_url} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{u.name || "No name"}</div>
          <div className="truncate text-sm text-slate-500">{u.email}</div>
          <div className="mt-1 text-xs text-slate-400">Asked {when(u.requested_at)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`role-${u.id}`}>Access for {u.email}</label>
          <Select id={`role-${u.id}`} value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-auto">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </Select>
          <Button onClick={() => decide.mutate("approve")} busy={decide.isPending && decide.variables === "approve"} disabled={decide.isPending}>
            <Check className="size-4" /> Approve
          </Button>
          <Button variant="secondary" onClick={() => decide.mutate("reject")} busy={decide.isPending && decide.variables === "reject"} disabled={decide.isPending}>
            <X className="size-4" /> Reject
          </Button>
        </div>
      </div>
      {decide.error && <div className="mt-3"><Alert>{errorText(decide.error)}</Alert></div>}
    </Card>
  );
}

export default function Approvals() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  const all = useQuery({ queryKey: ["admin-users", "all"], queryFn: async () => (await api.get<AdminUser[]>("/admin/users/")).data });
  const change = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<Pick<AdminUser, "role" | "status">> }) => (await api.patch(`/admin/users/${id}/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  if (all.isLoading) return <Spinner />;
  if (all.error) return <Alert>{errorText(all.error)}</Alert>;
  const pending = all.data!.filter((u) => u.status === "pending");
  const others = all.data!.filter((u) => u.status !== "pending");

  return (
    <>
      <PageHeader title="Approvals & people" subtitle="Approve new people and choose what they can do. You can change it any time." />
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">Waiting for you · {pending.length}</h2>
      <div className="grid gap-3">
        {notice && <Alert tone="green">{notice}</Alert>}
        {pending.length ? pending.map((u) => <Request key={u.id} u={u} onApproved={setNotice} />)
          : <Card><EmptyState icon={<Inbox />} title="No requests right now">When someone signs in with Google for the first time, they'll appear here and you'll get an email.</EmptyState></Card>}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-bold uppercase tracking-wider text-slate-500">Everyone · {others.length}</h2>
      {change.error && <div className="mb-3"><Alert>{errorText(change.error)}</Alert></div>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
            {["Person", "Access", "Status", "Last sign-in", ""].map((h) => <th key={h} className="px-5 py-2.5 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>
            {others.map((u) => {
              const self = u.id === user?.id;
              return (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={u.name || u.email} src={u.profile.photo_url} size="sm" />
                    <div className="min-w-0"><div className="font-semibold">{u.name || u.email}{self && <span className="font-normal text-slate-400"> (you)</span>}</div><div className="truncate text-xs text-slate-500">{u.email}</div></div></div></td>
                  <td className="px-5 py-3">
                    {self ? <Badge tone="brand">Admin</Badge> : (
                      <Select aria-label={`Access for ${u.email}`} className="w-auto py-1.5" value={u.role} disabled={u.status !== "approved" || change.isPending}
                        onChange={(e) => change.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>)}
                  </td>
                  <td className="px-5 py-3"><Badge tone={u.status === "approved" ? "green" : u.status === "rejected" ? "red" : "slate"}>{u.status}</Badge></td>
                  <td className="px-5 py-3 text-slate-500">{when(u.last_login)}</td>
                  <td className="px-5 py-3 text-right">
                    {!self && (u.status === "approved"
                      ? <Button variant="ghost" className="py-1.5" onClick={() => change.mutate({ id: u.id, body: { status: "disabled" } })}>Switch off</Button>
                      : <Button variant="secondary" className="py-1.5" onClick={() => change.mutate({ id: u.id, body: { status: "approved" } })}>Give access</Button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
