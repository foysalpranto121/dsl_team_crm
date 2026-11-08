import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Heart, Hand, PartyPopper, Trophy, type LucideIcon } from "lucide-react";
import { errorText, api } from "@/api/client";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/ui";
import { PageSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { date, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { feedQuery, type Post, type ReactionKind } from "./api";

const REACTIONS: { key: ReactionKind; label: string; icon: LucideIcon }[] = [{ key: "clap", label: "Well done", icon: Hand }, { key: "party", label: "Celebrate", icon: PartyPopper }, { key: "heart", label: "Love it", icon: Heart }];
const KIND: Record<Post["kind"], { icon: LucideIcon; cls: string }> = {
  win: { icon: Trophy, cls: "bg-success-soft text-success-text" },
  badge: { icon: Award, cls: "bg-accent-soft text-accent-text" },
  thanks: { icon: Heart, cls: "bg-primary-soft text-primary-text" },
};

function PostCard({ p, reactions }: { p: Post; reactions: boolean }) {
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: async (kind: ReactionKind) => api.post(`/recognition/feed/${p.id}/react/`, { kind }),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedQuery.queryKey }),
    onError: (e) => toast.error("Couldn't add that", { description: errorText(e) }),
  });
  const K = KIND[p.kind];
  return (
    <li className="flex gap-3 px-5 py-4">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", K.cls)}><K.icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-medium">{p.title}</p>
          <span className="text-xs text-muted-foreground">{date(p.day, "short")}</span>
        </div>
        {p.value != null && <p className="text-sm tabular-nums text-muted-foreground">{money(p.value, { currency: p.currency })}</p>}
        {p.message && <blockquote className="mt-1 border-l-2 border-border pl-3 text-sm">{p.message}{p.by && p.kind !== "thanks" && <span className="text-muted-foreground"> · {p.by}</span>}</blockquote>}
        {reactions && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Reactions">
            {REACTIONS.map((r) => {
              const on = p.reacted.includes(r.key), n = p.reactions[r.key];
              return (
                <button key={r.key} type="button" aria-pressed={on} disabled={react.isPending} onClick={() => react.mutate(r.key)} aria-label={`${r.label}${n ? `, ${n}` : ""}`}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden max-sm:h-11 max-sm:px-3.5",
                    on ? "border-primary bg-primary-soft text-primary-text" : "border-border text-muted-foreground hover:border-input hover:text-foreground")}>
                  <r.icon className="size-3.5" aria-hidden />{n > 0 && <span className="tabular-nums">{n}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

/** The win feed (SRS v0.5 FR-MO5): verified wins, badges and words of thanks, with reactions. Everyone sees it, management included. */
export default function WinFeed() {
  const q = useQuery(feedQuery);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader title="Wins" subtitle="Verified wins, badges and words of thanks from across the team." />
      <div className="max-w-3xl">
        {!d.enabled ? <div className="card"><EmptyState icon={<Trophy />} title="The win feed is switched off">An admin can switch it on in Team setup.</EmptyState></div>
          : !d.posts.length ? <div className="card"><EmptyState icon={<Trophy />} title="No wins yet">A win shows up here once a supervisor verifies its work order.</EmptyState></div>
            : <section className="card overflow-hidden" aria-label="Win feed"><ul className="divide-y divide-border">{d.posts.map((p) => <PostCard key={p.id} p={p} reactions={d.reactions} />)}</ul></section>}
      </div>
    </>
  );
}
