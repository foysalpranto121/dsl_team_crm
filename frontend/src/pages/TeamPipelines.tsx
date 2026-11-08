import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { api, errorText } from "../api/client";
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { configQuery } from "../features/pipeline/api";

interface Person {
  user: { id: number; name: string }; product: string; due_count: number;
  funnel: { prospects: number; contacted: number; leads: number; opps: number; clients: number };
  totals: { leads: number; opps: number; clients: number; points: number }; targets: Record<string, number>;
  prospects: { id: number; company: string; contact: string; country: string; stage: string; next_follow_up: string | null; next_action: string }[];
}
const fmt = (s: string | null) => (s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");

export default function TeamPipelines() {
  const q = useQuery({ queryKey: ["team-pipelines"], queryFn: async () => (await api.get<{ people: Person[] }>("/tracker/team/")).data.people });
  const stageName = Object.fromEntries((useQuery(configQuery).data?.stages ?? []).map((s) => [s.key, s.name]));
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{errorText(q.error)}</Alert>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Team pipelines" subtitle="Pipelines people chose to share with admins. Read-only; each person decides in My tracker → Settings." />
      {!q.data!.length ? (
        <Card><EmptyState icon={<Briefcase />} title="No one is sharing yet">Ask the team to tick "Share my pipeline with admins" in My tracker → Settings.</EmptyState></Card>
      ) : (
        <div className="grid gap-6">
          {q.data!.map((p) => (
            <Card key={p.user.id} className="overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
                <div><h2 className="text-lg font-bold">{p.user.name}</h2><p className="text-sm text-slate-500">{p.product || "No product set"}</p></div>
                {p.due_count > 0 && <Badge tone="amber">{p.due_count} follow-up{p.due_count === 1 ? "" : "s"} due</Badge>}
              </div>
              <div className="mt-4 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-5 dark:border-white/10">
                {([["Prospects", p.funnel.prospects], ["Contacted", p.funnel.contacted], ["Leads", p.funnel.leads], ["Opportunities", p.funnel.opps], ["Clients", p.funnel.clients]] as const).map(([l, v]) => (
                  <div key={l} className="px-5 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{l}</div><div className="num text-xl">{v}</div></div>))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:bg-white/5">
                    {["Open prospect", "Market", "Stage", "Next follow-up"].map((h) => <th key={h} className="px-5 py-2">{h}</th>)}</tr></thead>
                  <tbody>{p.prospects.length ? p.prospects.map((x) => (
                    <tr key={x.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="px-5 py-2"><div className="font-semibold">{x.company}</div><div className="text-xs text-slate-500">{x.contact}</div></td>
                      <td className="px-5 py-2">{x.country}</td><td className="px-5 py-2">{stageName[x.stage] ?? x.stage}</td>
                      <td className="px-5 py-2"><span className={x.next_follow_up && x.next_follow_up < today ? "font-semibold text-accent-600" : ""}>{fmt(x.next_follow_up)}</span>
                        <div className="text-xs text-slate-500">{x.next_action}</div></td>
                    </tr>)) : <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-500">No open prospects.</td></tr>}</tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
