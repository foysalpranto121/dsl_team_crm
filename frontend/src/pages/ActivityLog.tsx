import { useInfiniteQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api/client";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Spinner } from "../components/ui";

type Detail = Record<string, unknown>;
interface Item { id: number; created_at: string; actor: { name: string; email: string } | null; action: string; target: string; detail: Detail; flagged: boolean }
interface Page { results: Item[]; page: number; has_more: boolean; flagged_count: number }

const FILTERS = [["", "Everything"], ["entry.", "Sheet entries"], ["kpi.", "Weekly KPI"], ["user.", "People & access"],
  ["sheet.", "Sheets & targets"], ["task.", "Tasks"], ["role.", "Job roles"], ["settings.", "Team rules"], ["announcement.", "Announcements"], ["import.", "Excel import"], ["renewal.", "Renewals"], ["contract.", "Contracts"]] as const;

const hours = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x != null).length : 0);
const day = (v: unknown) => (typeof v === "string" ? new Date(v + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const pairs = (d: Detail) => {
  const before = (d.before ?? {}) as Detail, after = (d.after ?? {}) as Detail;
  const changed = Object.keys(after).filter((k) => String(before[k] ?? "") !== String(after[k] ?? ""));   // only what actually changed
  return changed.length ? changed.map((k) => `${k.replace(/^target_/, "").replace(/_/g, " ")}: ${String(before[k] ?? "—")} → ${String(after[k])}`).join(" · ") : "no visible change";
};

/** Turns a recorded change into a plain sentence. */
function describe(i: Item): { what: string; more: string } {
  const d = i.detail;
  switch (i.action) {
    case "entry.save": return { what: `Filled in ${day(d.day)} on "${i.target}"`, more: `${hours(d.before)} h → ${hours(d.after)} h` };
    case "entry.clear": return { what: `Cleared ${day(d.day)} on "${i.target}"`, more: "" };
    case "kpi.save": return { what: `Weekly KPI for "${i.target}", week of ${day(d.week)}`, more: `leads ${d.leads ?? 0} · opps ${d.opps ?? 0} · clients ${d.clients ?? 0} · revenue ${d.revenue ?? 0}` };
    case "sheet.save": return { what: `Changed sheet "${i.target}"`, more: pairs(d) };
    case "sheet.delete": return { what: `Deleted sheet "${i.target}"`, more: `${d.days} days · ${d.kpi_weeks} KPI weeks removed` };
    case "team.reset": return { what: "Deleted all team data", more: `${d.sheets} sheets · ${d.days} days · ${d.kpi_weeks} KPI weeks removed` };
    case "sheet.linked": return { what: `Linked sheet "${i.target}" to its person`, more: "the name matched" };
    case "settings.save": return { what: "Changed the team rules", more: Object.entries(d).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") };
    case "task.save": return { what: `Changed task "${i.target}"`, more: d.after ? pairs(d) : `points ${d.points ?? ""}` };
    case "role.save": return { what: `Changed job role "${i.target}"`, more: d.tasks != null ? `${d.tasks} tasks` : "" };
    case "user.approve": return { what: `Approved ${i.target} as ${d.role}`, more: Array.isArray(d.linked) && d.linked.length ? `linked to ${d.linked.join(", ")}` : "" };
    case "user.reject": return { what: `Rejected ${i.target}`, more: "" };
    case "user.update": return { what: `Changed access for ${i.target}`, more: pairs(d) };
    case "announcement.save": return { what: `Posted an announcement: "${i.target}"`, more: "" };
    case "announcement.delete": return { what: `Removed an announcement: "${i.target}"`, more: "" };
    case "display.create": return { what: `Added TV screen "${i.target}"`, more: "" };
    case "display.update": return { what: `Changed TV screen "${i.target}"`, more: pairs(d) };
    case "display.rotate": return { what: `Made a new link for TV screen "${i.target}"`, more: "the old link stopped working" };
    case "display.delete": return { what: `Deleted TV screen "${i.target}"`, more: "" };
    case "huddle.focus": return { what: "Posted today's focus from the morning huddle", more: i.target };
    case "digest.send": return { what: `Sent the weekly digest for ${i.target}`, more: `${d.recipients ?? "?"} people${d.automatic ? " · by the weekly schedule" : ""}` };
    case "import.workbook": return { what: d.replaced ? "Replaced all team data with an Excel import" : "Imported the Excel workbook", more: `${d.sheets} sheets · ${d.kpi_weeks} KPI weeks` };
    case "contract.create": return { what: `Added the contract ${i.target}`, more: `ends ${day(d.ends)} · BDT ${d.value ?? "?"}` };
    case "contract.update": return { what: `Changed the contract ${i.target}`, more: pairs(d) };
    case "contract.delete": return { what: `Deleted the contract ${i.target}`, more: `ended ${day(d.ends)} · ${d.status}` };
    case "contract.import": return { what: "Imported contracts from a CSV", more: `${d.created ?? 0} added · ${d.updated ?? 0} updated · ${d.skipped ?? 0} skipped` };
    case "renewal.update": return { what: `Updated the renewal of ${i.target}`, more: pairs(d) };
    case "renewal.won": return { what: `Recorded a renewal: ${i.target}`, more: `BDT ${d.value} until ${day(d.until)} · agreed ${day(d.on)}${d.owner ? ` · counts for ${d.owner}` : ""}` };
    case "renewal.lost": return { what: `Recorded “not renewing”: ${i.target}`, more: String(d.reason ?? "") };
    case "renewal.reopen": return { what: `Reopened the renewal of ${i.target}`, more: d.was === "won" ? "the renewal and its next term were undone" : "it was marked as not renewing" };
    case "renewal.settings": return { what: "Changed the renewal reminders", more: pairs(d) };
    default: return { what: `${i.action} ${i.target}`, more: "" };
  }
}

export default function ActivityLog() {
  const [flagged, setFlagged] = useState(false);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["activity", flagged, action, q],
    queryFn: async ({ pageParam }) => (await api.get<Page>(`/admin/activity/?page=${pageParam}&flagged=${flagged ? 1 : 0}&action=${encodeURIComponent(action)}&q=${encodeURIComponent(q)}`)).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });
  const items = query.data?.pages.flatMap((p) => p.results) ?? [];
  const flaggedCount = query.data?.pages[0]?.flagged_count ?? 0;

  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change to the team's data: who, what and when. Newest first." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setFlagged(!flagged)} aria-pressed={flagged}
          className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold",
            flagged ? "border-accent-500 bg-accent-500 text-white" : "border-slate-300 text-slate-700 dark:border-white/15 dark:text-slate-200")}>
          <AlertTriangle className="size-4" /> Corrections to locked days {flaggedCount > 0 && <span className="num">({flaggedCount})</span>}
        </button>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Type of change" className="input w-auto">
          {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Input className="max-w-xs" placeholder="Search person or sheet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the log" />
      </div>

      {query.isLoading ? <Spinner /> : query.error ? <Alert>{errorText(query.error)}</Alert> : !items.length ? (
        <Card><EmptyState icon={<ClipboardList />} title="Nothing recorded yet">{flagged ? "No admin has changed a locked day." : "Changes appear here as people use the system."}</EmptyState></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5">
              {["When", "Who", "What", "Details"].map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr></thead>
            <tbody>
              {items.map((i) => {
                const { what, more } = describe(i);
                return (
                  <tr key={i.id} className={clsx("border-b border-slate-100 align-top last:border-0 dark:border-white/5", i.flagged && "bg-accent-500/[0.05]")}>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{new Date(i.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2.5"><div className="font-medium">{i.actor?.name ?? "System"}</div><div className="text-xs text-slate-500">{i.actor?.email}</div></td>
                    <td className="px-4 py-2.5">{what} {i.flagged && <Badge tone="accent" className="ml-1">Locked day corrected</Badge>}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{more}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {query.hasNextPage && <div className="border-t border-slate-200 p-3 text-center dark:border-white/10">
            <Button variant="secondary" onClick={() => query.fetchNextPage()} busy={query.isFetchingNextPage}>Show older changes</Button></div>}
        </Card>
      )}
    </>
  );
}
