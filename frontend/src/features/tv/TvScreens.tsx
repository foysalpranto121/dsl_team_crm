import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, MoreHorizontal, Pencil, Plus, Trash2, Trophy, Tv } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorText } from "@/api/client";
import type { Task } from "@/api/types";
import { EmptyState, ErrorState } from "@/components/data/states";
import { Alert, PageHeader } from "@/components/ui";
import { Badge, StatusPill, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox, Choice, RadioGroup, RadioGroupItem, Switch } from "@/components/ui/form-controls";
import { Field, Input, SearchInput } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { SimpleSelect } from "@/components/ui/select";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { relative } from "@/lib/format";
import { PANELS, screenLink, type DisplayScreen, type DisplayScreenWithToken, type LeadersMode, type PanelKey } from "./types";

/** Admin → TV screens: set up the office TVs (SRS v0.3 §14.5) and choose which tasks count as wins. */

type Form = Pick<DisplayScreen, "name" | "panels" | "rotate_seconds" | "leaders" | "leaders_count" | "show_values" | "celebrate" | "sound">;
const NEW_SCREEN: Form = { name: "Sales floor TV", panels: ["progress", "wins", "leaders"], rotate_seconds: 20, leaders: "top", leaders_count: 3,
  show_values: false, celebrate: true, sound: true };
const KEY = ["display-screens"];

function connection(s: DisplayScreen): { status: Status; text: string } {
  if (!s.active) return { status: "neutral", text: "Turned off" };
  if (!s.last_seen_at) return { status: "info", text: "Waiting for the TV to connect" };
  const minutes = (Date.now() - new Date(s.last_seen_at).getTime()) / 60_000;
  return minutes < 3 ? { status: "good", text: "On screen now" } : { status: "warning", text: `Last seen ${relative(s.last_seen_at)}` };
}

const label = (k: PanelKey) => PANELS.find((p) => p.key === k)?.label ?? k;

// ---------- add / edit ----------

function ScreenSheet({ screen, open, onOpenChange, onCreated }: {
  screen: DisplayScreen | null; open: boolean; onOpenChange: (open: boolean) => void; onCreated: (s: DisplayScreenWithToken) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(screen ?? NEW_SCREEN);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: async () => screen
      ? (await api.patch<DisplayScreen>(`/display/screens/${screen.id}/`, f)).data
      : (await api.post<DisplayScreenWithToken>("/display/screens/", f)).data,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: KEY });
      onOpenChange(false);
      if ("token" in s) onCreated(s as DisplayScreenWithToken);
      else toast.success("Screen saved", { description: "The TV picks up the change within 20 seconds." });
    },
    onError: (e) => toast.error("Couldn't save the screen", { description: errorText(e) }),
  });
  // Keep the panels in their standard order whichever order they're ticked in.
  const togglePanel = (k: PanelKey, on: boolean) =>
    set("panels", PANELS.map((p) => p.key).filter((x) => (x === k ? on : f.panels.includes(x))));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <SheetHeader>
            <SheetTitle>{screen ? `Edit “${screen.name}”` : "Add a TV screen"}</SheetTitle>
            <SheetDescription>What this TV shows. Changes reach the TV within 20 seconds.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-6">
            <Field label="Name" hint="Where the TV is, e.g. “Sales floor” or “Meeting room”." required>
              <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required />
            </Field>

            <fieldset>
              <legend className="label">Panels it rotates through</legend>
              <div className="space-y-3">
                {PANELS.map((p) => (
                  <Choice key={p.key} label={p.label} description={p.description}
                    control={<Checkbox checked={f.panels.includes(p.key)} onCheckedChange={(v) => togglePanel(p.key, v === true)} />} />
                ))}
              </div>
              {f.panels.length === 0 && <p className="mt-2 text-xs text-danger-text" role="alert">Choose at least one panel.</p>}
            </fieldset>

            <Field label="Change panel every">
              <SimpleSelect value={String(f.rotate_seconds)} onValueChange={(v) => set("rotate_seconds", Number(v))} aria-label="Change panel every"
                options={[10, 15, 20, 30, 45, 60].map((s) => ({ value: String(s), label: `${s} seconds` }))} />
            </Field>

            {f.panels.includes("leaders") && (
              <fieldset>
                <legend className="label">Leaders panel</legend>
                <RadioGroup value={f.leaders} onValueChange={(v) => set("leaders", v as LeadersMode)}>
                  <Choice control={<RadioGroupItem value="top" />} label="Top performers" description="Highest composite score this month." />
                  <Choice control={<RadioGroupItem value="improvers" />} label="Most improved" description="Each person against their own last month — fairer when experience differs." />
                  <Choice control={<RadioGroupItem value="off" />} label="Don't show leaders" />
                </RadioGroup>
                {f.leaders !== "off" && (
                  <Field label="How many people" className="mt-4" hint="Only the top few are ever shown — never the bottom of the list.">
                    <SimpleSelect value={String(f.leaders_count)} onValueChange={(v) => set("leaders_count", Number(v))} aria-label="How many people"
                      options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
                  </Field>
                )}
              </fieldset>
            )}

            <div className="space-y-4 border-t border-border pt-5">
              <Choice control={<Switch checked={f.celebrate} onCheckedChange={(v) => set("celebrate", v)} />}
                label="Celebrate new wins" description="A full-screen celebration when someone logs a win today." />
              <Choice control={<Switch checked={f.sound && f.celebrate} disabled={!f.celebrate} onCheckedChange={(v) => set("sound", v)} />}
                label="Play a sound with it" description="Click the TV page once after opening it — browsers block sound until then." />
              <Choice control={<Switch checked={f.show_values} onCheckedChange={(v) => set("show_values", v)} />}
                label="Show client names and amounts" description="Off by default: win details and the revenue figure stay off the shared screen. Revenue still shows as a percentage." />
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" busy={save.isPending} disabled={!f.name.trim() || f.panels.length === 0}>{screen ? "Save changes" : "Add screen"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ---------- the link, shown once ----------

function LinkDialog({ screen, onClose }: { screen: DisplayScreenWithToken | null; onClose: () => void }) {
  const link = screen ? screenLink(screen.token) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy", { description: "Select the link and copy it by hand." });
    }
  };
  return (
    <Dialog open={!!screen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Link for “{screen?.name}”</DialogTitle>
          <DialogDescription>Open it in the TV's web browser. This is the only time the full link is shown.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Screen link" className="font-mono text-xs" />
            <Button type="button" variant="secondary" onClick={copy}><Copy /> Copy</Button>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>On the TV, open the link in Chrome or Edge.</li>
            <li>Click anywhere on the page once, so it may play the win sound.</li>
            <li>Press <Kbd>F</Kbd> for full screen.</li>
          </ol>
          <Alert tone="amber">Anyone with this link can see the team's progress. Keep it on the TV. If it leaks, make a new link — the old one stops working at once.</Alert>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => window.open(link, "_blank", "noopener")}><ExternalLink /> Open on this computer</Button>
          <Button type="button" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- one screen ----------

function ScreenCard({ s, onEdit, onRotate, onDelete }: { s: DisplayScreen; onEdit: () => void; onRotate: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const c = connection(s);
  const toggle = useMutation({
    mutationFn: async (active: boolean) => (await api.patch<DisplayScreen>(`/display/screens/${s.id}/`, { active })).data,
    onSuccess: (x) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(x.active ? `“${x.name}” turned on` : `“${x.name}” turned off`, { description: x.active ? undefined : "The TV shows that its link no longer works." });
    },
    onError: (e) => toast.error("Couldn't change the screen", { description: errorText(e) }),
  });
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text"><Tv className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{s.name}</h3>
          <div className="mt-1"><StatusPill status={c.status}>{c.text}</StatusPill></div>
        </div>
        <Switch checked={s.active} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label={s.active ? `Turn off ${s.name}` : `Turn on ${s.name}`} className="mt-2" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${s.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRotate}><Link2 /> Make a new link</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={onDelete}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Panels</dt>
          <dd className="mt-1 flex flex-wrap gap-1">{s.panels.map((p) => <Badge key={p} tone="outline">{label(p)}</Badge>)}</dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Changes every</dt><dd className="mt-0.5 font-medium">{s.rotate_seconds} seconds</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Leaders</dt>
          <dd className="mt-0.5 font-medium">{s.leaders === "off" || !s.panels.includes("leaders") ? "Not shown" : `${s.leaders === "top" ? "Top" : "Most improved"} ${s.leaders_count}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">New wins</dt>
          <dd className="mt-0.5 font-medium">{s.celebrate ? `Celebrated${s.sound ? ", with sound" : ""}` : "Listed only"}</dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Client names and amounts</dt><dd className="mt-0.5 font-medium">{s.show_values ? "Shown" : "Hidden"}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Link <span className="font-mono">/tv#{s.token_hint}…</span>{s.created_by ? ` · added by ${s.created_by}` : ""}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil /> Edit</Button>
          <Button size="sm" variant="secondary" onClick={onRotate}><Link2 /> New link</Button>
        </div>
      </div>
    </article>
  );
}

// ---------- which tasks are wins ----------

function WinTasks() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: async () => (await api.get<Task[]>("/team/tasks/")).data });
  const flip = useMutation({
    mutationFn: async ({ id, on }: { id: number; on: boolean }) => (await api.patch<Task>(`/team/tasks/${id}/`, { counts_as_win: on })).data,
    onSuccess: (t) => {
      qc.setQueryData<Task[]>(["tasks"], (old) => old?.map((x) => (x.id === t.id ? t : x)));
      toast.success(t.counts_as_win ? `“${t.name}” now counts as a win` : `“${t.name}” no longer counts as a win`);
    },
    onError: (e) => toast.error("Couldn't change the task", { description: errorText(e) }),
  });
  const all = tasks.data ?? [];
  const wins = all.filter((t) => t.counts_as_win);
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    all.filter((t) => (t.active || t.counts_as_win) && t.name.toLowerCase().includes(q.trim().toLowerCase()))
      .forEach((t) => m.set(t.type || "Other", [...(m.get(t.type || "Other") ?? []), t]));
    return [...m];
  }, [all, q]);

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="win-tasks">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning-text"><Trophy className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 id="win-tasks" className="text-base font-semibold">What counts as a win</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">When someone logs one of these tasks in their sheet, it appears under Recent wins and the TV celebrates it. Usually just the work-order task.</p>
        </div>
      </div>
      {tasks.isLoading ? (
        <div className="mt-5 space-y-2"><Skeleton className="h-5 w-64" /><Skeleton className="h-5 w-52" /></div>
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Wins now:</span>
            {wins.length ? wins.map((t) => <Badge key={t.id} tone="warning"><Trophy aria-hidden />{t.name}</Badge>)
              : <span className="text-xs text-danger-text">None — the Recent wins panel stays empty until you choose one.</span>}
          </div>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task…" aria-label="Find a task" className="mt-4 w-full sm:w-72" />
          <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-border p-4">
            {groups.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No task matches “{q}”.</p> : (
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map(([type, list]) => (
                  <div key={type}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{type}</h3>
                    <div className="space-y-2.5">
                      {list.map((t) => (
                        <Choice key={t.id} label={t.name} description={`${Number(t.points)} ${Number(t.points) === 1 ? "point" : "points"}`}
                          control={<Checkbox checked={t.counts_as_win} disabled={flip.isPending} onCheckedChange={(v) => flip.mutate({ id: t.id, on: v === true })} />} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- page ----------

export default function TvScreens() {
  const qc = useQueryClient();
  const screens = useQuery({ queryKey: KEY, queryFn: async () => (await api.get<DisplayScreen[]>("/display/screens/")).data, refetchInterval: 60_000 });
  const [sheet, setSheet] = useState<{ open: boolean; screen: DisplayScreen | null; key: number }>({ open: false, screen: null, key: 0 });
  const [link, setLink] = useState<DisplayScreenWithToken | null>(null);
  const [rotating, setRotating] = useState<DisplayScreen | null>(null);
  const [deleting, setDeleting] = useState<DisplayScreen | null>(null);
  const edit = (screen: DisplayScreen | null) => setSheet((s) => ({ open: true, screen, key: s.key + 1 }));

  const rotate = async () => {
    try {
      const s = (await api.post<DisplayScreenWithToken>(`/display/screens/${rotating!.id}/rotate/`)).data;
      qc.invalidateQueries({ queryKey: KEY });
      setLink(s);
    } catch (e) {
      toast.error("Couldn't make a new link", { description: errorText(e) });
      throw e;
    }
  };
  const remove = async () => {
    try {
      await api.delete(`/display/screens/${deleting!.id}/`);
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(`“${deleting!.name}” deleted`);
    } catch (e) {
      toast.error("Couldn't delete the screen", { description: errorText(e) });
      throw e;
    }
  };

  const list = screens.data ?? [];
  return (
    <>
      <PageHeader title="TV screens" subtitle="Team progress, wins and leaders on the office TV — read-only, refreshed every 20 seconds."
        actions={<Button onClick={() => edit(null)}><Plus /> Add a screen</Button>} />

      {screens.isLoading ? <PageSkeleton stats={0} charts={0} rows={3} />
        : screens.isError ? <div className="card"><ErrorState error={screens.error} onRetry={() => screens.refetch()} /></div>
        : list.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Tv />} title="Put the team's progress on the office TV"
              action={<Button onClick={() => edit(null)}><Plus /> Add your first screen</Button>}>
              Add a screen, open its link in the TV's browser and press F. It shows today's, this week's and this month's progress,
              recent wins with a celebration, and the top performers — never who is behind.
            </EmptyState>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((s) => <ScreenCard key={s.id} s={s} onEdit={() => edit(s)} onRotate={() => setRotating(s)} onDelete={() => setDeleting(s)} />)}
          </div>
        )}

      <div className="mt-6"><WinTasks /></div>

      <ScreenSheet key={sheet.key} screen={sheet.screen} open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} onCreated={setLink} />
      <LinkDialog screen={link} onClose={() => setLink(null)} />
      <ConfirmDialog open={!!rotating} onOpenChange={(o) => { if (!o) setRotating(null); }} tone="primary" confirmLabel="Make new link"
        title={`Make a new link for “${rotating?.name ?? ""}”?`}
        description="The TV that uses the current link shows “link no longer works” until you open the new link on it." onConfirm={rotate} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} confirmLabel="Delete screen"
        title={`Delete “${deleting?.name ?? ""}”?`} description="Its link stops working at once. You can add the screen again later, with a new link." onConfirm={remove} />
    </>
  );
}
