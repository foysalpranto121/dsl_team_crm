import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { money } from "@/lib/format";
import { celebrateQuery } from "./api";

const COLOURS = ["var(--accent)", "var(--primary)", "var(--success)", "var(--warning)"];
const BITS = Array.from({ length: 18 }, (_, i) => ({ left: `${4 + (i * 92) / 17}%`, delay: `${(i % 6) * 90}ms`, colour: COLOURS[i % COLOURS.length], size: 6 + (i % 3) * 2 }));

/** SRS v0.5 FR-MO4, §10.4: the moment a verified win gets, and only a verified win: a short animation (none with reduced motion), and the supervisor's message.
 *  A new badge gets a quiet note. Mounted once in the app's layout, so it shows wherever the person is. */
export function Celebrate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ ...celebrateQuery, enabled: !!user && user.role !== "viewer" });
  const seen = useMutation({
    mutationFn: async (body: { posts?: number[]; badges?: number[] }) => api.post("/recognition/celebrate/", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recognition"] }),
  });
  const noted = useRef(new Set<number>());
  const badges = q.data?.badges ?? [];
  useEffect(() => {
    const fresh = badges.filter((b) => !noted.current.has(b.id));
    if (!fresh.length) return;
    fresh.forEach((b) => { noted.current.add(b.id); toast.success(`New badge: ${b.name}`, { description: b.why }); });
    seen.mutate({ badges: fresh.map((b) => b.id) });
  }, [badges]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Closes straight away: a failed "seen" call must never trap someone in the dialog. It just comes back next time.
  const [closed, setClosed] = useState<number[]>([]);
  const win = q.data?.wins.find((w) => !closed.includes(w.id));
  if (!win) return null;
  const close = () => { setClosed((c) => [...c, win.id]); seen.mutate({ posts: [win.id] }); };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent size="sm" className="overflow-hidden">
        <div className="relative px-6 pb-6 pt-8 text-center">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {BITS.map((b, i) => <span key={i} className="win-bit absolute -top-3 rounded-[2px]" style={{ left: b.left, width: b.size, height: b.size, background: b.colour, animationDelay: b.delay }} />)}
          </div>
          <div className="win-pop mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success-text"><Trophy className="size-7" aria-hidden /></div>
          <DialogTitle className="mt-4 text-xl">{win.title}</DialogTitle>
          <DialogDescription className="mt-1">Verified. {win.value != null ? `${money(win.value, { currency: win.currency })} now counts towards your revenue.` : "It now counts towards your numbers."}</DialogDescription>
          {win.message && <blockquote className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm">{win.message}{win.by && <span className="mt-1 block text-xs text-muted-foreground">{win.by}</span>}</blockquote>}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={close}>Thank you</Button>
            <Button variant="ghost" asChild onClick={close}><Link to="/wins">See the win feed</Link></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
