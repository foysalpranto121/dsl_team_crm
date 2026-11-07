import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase, CalendarCheck2, Clock, Coins, Copy, Download, Inbox, MoreHorizontal, Pencil, Plus, Send, Star, Target, Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AvatarGroup } from "../components/Brand";
import { ChartCard, ChartLegend, ChartTooltip, useChartTheme } from "../components/data/chart";
import { DataTable } from "../components/data/data-table";
import { KanbanBoard, KanbanCard, KanbanColumn } from "../components/data/kanban";
import { StatCard } from "../components/data/stat-card";
import { EmptyState, ErrorState } from "../components/data/states";
import { StepTracker, Timeline } from "../components/data/steps";
import { Alert, PageHeader } from "../components/ui";
import { Badge, StatusPill, type Status } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Combobox } from "../components/ui/combobox";
import { DatePicker } from "../components/ui/date-picker";
import {
  ConfirmDialog, Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Checkbox, Choice, RadioGroup, RadioGroupItem, Switch } from "../components/ui/form-controls";
import { Field, Input, NativeSelect, SearchInput, Textarea } from "../components/ui/input";
import { Kbd } from "../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Progress, ProgressRing } from "../components/ui/progress";
import { SimpleSelect } from "../components/ui/select";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "../components/ui/toaster";
import { Tip } from "../components/ui/tooltip";
import { money, num, pct, signed } from "../lib/format";

/* Every v3 component in one place, for checking the look in light and dark mode. All data on this page is sample data. */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const SWATCHES = [
  ["background", "bg-background"], ["card", "bg-card"], ["muted", "bg-muted"], ["border", "bg-border"],
  ["primary", "bg-primary"], ["primary-soft", "bg-primary-soft"], ["success", "bg-success"], ["success-soft", "bg-success-soft"],
  ["warning", "bg-warning"], ["warning-soft", "bg-warning-soft"], ["danger", "bg-danger"], ["danger-soft", "bg-danger-soft"],
] as const;
const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7", "bg-chart-8"];

interface Person { id: string; name: string; role: string; hours: number; target: number; points: number; leads: number; status: Status; statusLabel: string }
const PEOPLE: Person[] = [
  { id: "1", name: "Nadia Rahman", role: "National Sales (Tender)", hours: 34, target: 40, points: 212, leads: 4, status: "good", statusLabel: "On pace" },
  { id: "2", name: "Arif Hossain", role: "Corporate Sales", hours: 41, target: 40, points: 268, leads: 6, status: "good", statusLabel: "Target met" },
  { id: "3", name: "Sadia Karim", role: "International Sales", hours: 26, target: 40, points: 150, leads: 2, status: "warning", statusLabel: "Near" },
  { id: "4", name: "Tanvir Ahmed", role: "Marketing", hours: 18, target: 40, points: 96, leads: 1, status: "danger", statusLabel: "Behind" },
  { id: "5", name: "Farhana Islam", role: "Corporate Sales", hours: 37, target: 40, points: 231, leads: 5, status: "good", statusLabel: "On pace" },
];
const COLUMNS: ColumnDef<Person, any>[] = [
  { accessorKey: "name", header: "Person", cell: (c) => <div><div className="font-medium text-foreground">{c.row.original.name}</div><div className="text-xs text-muted-foreground">{c.row.original.role}</div></div>, enableHiding: false },
  { accessorKey: "hours", header: "Week hours", meta: { numeric: true }, cell: (c) => `${c.getValue()} / ${c.row.original.target}` },
  { id: "progress", header: "Progress", enableSorting: false, meta: { label: "Progress" },
    cell: (c) => <Progress value={c.row.original.hours} max={c.row.original.target} size="sm" tone={c.row.original.hours >= c.row.original.target ? "success" : "primary"} label={`${c.row.original.name}: hours vs target`} className="w-28" /> },
  { accessorKey: "points", header: "Points", meta: { numeric: true } },
  { accessorKey: "leads", header: "Leads", meta: { numeric: true } },
  { accessorKey: "statusLabel", header: "Status", cell: (c) => <StatusPill status={c.row.original.status}>{c.row.original.statusLabel}</StatusPill> },
];
const ACTIVITIES = [
  { value: "cold-call", label: "Cold calling", hint: "5 pts", group: "Lead generation" },
  { value: "linkedin", label: "LinkedIn outreach", hint: "4 pts", group: "Lead generation" },
  { value: "visit", label: "Client visit", hint: "8 pts", group: "Client work" },
  { value: "meeting", label: "Client meeting", hint: "8 pts", group: "Client work" },
  { value: "proposal", label: "Proposal / tender preparation", hint: "10 pts", group: "Sales" },
  { value: "report", label: "Monthly report preparation", hint: "3 pts", group: "Planning & reporting" },
];
const WEEKS = ["W40", "W41", "W42", "W43", "W44", "W45"];

function Charts() {
  const t = useChartTheme();
  const bars = PEOPLE.map((p) => ({ name: p.name.split(" ")[0], "This week": p.hours, "Last week": Math.max(0, p.hours - 6 + Number(p.id) * 2) }));
  const lines = WEEKS.map((w, i) => ({ week: w, Nadia: 150 + i * 14, Arif: 190 + i * 15 - (i % 2) * 20, Sadia: 120 + i * 6 }));
  const last = t.mode === "dark" ? "#4a5568" : "#c3cad6";   // last period in a quiet grey; this period carries the accent
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Hours per person" description="Saturday to Friday, compared with last week"
        legend={<ChartLegend items={[{ name: "This week", color: t.series[0] }, { name: "Last week", color: last }]} />}
        table={{ columns: ["Person", "This week", "Last week"], rows: bars.map((b) => [b.name, b["This week"], b["Last week"]]) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} barGap={2} margin={{ left: -18, right: 4, top: 4 }}>
            <CartesianGrid {...t.gridProps} />
            <XAxis dataKey="name" {...t.axis} />
            <YAxis {...t.axis} allowDecimals={false} />
            <Tooltip content={<ChartTooltip format={(v) => `${num(v)} h`} />} cursor={t.cursor} />
            <Bar dataKey="This week" fill={t.series[0]} {...t.bar} />
            <Bar dataKey="Last week" fill={last} {...t.bar} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Points trend" description="Last six weeks"
        legend={<ChartLegend items={["Nadia", "Arif", "Sadia"].map((n, i) => ({ name: n, color: t.series[i], kind: "line" as const }))} />}
        table={{ columns: ["Week", "Nadia", "Arif", "Sadia"], rows: lines.map((l) => [l.week, l.Nadia, l.Arif, l.Sadia]) }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lines} margin={{ left: -18, right: 8, top: 4 }}>
            <CartesianGrid {...t.gridProps} />
            <XAxis dataKey="week" {...t.axis} />
            <YAxis {...t.axis} />
            <Tooltip content={<ChartTooltip format={(v) => `${num(v)} pts`} />} cursor={{ stroke: t.grid }} />
            {["Nadia", "Arif", "Sadia"].map((n, i) => <Line key={n} type="monotone" dataKey={n} stroke={t.series[i]} {...t.line} />)}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

export default function UiKit() {
  const [activity, setActivity] = useState<string | null>("visit");
  const [day, setDay] = useState<string | null>(new Date().toISOString().slice(0, 10));
  const [stage, setStage] = useState("qualified");
  const [confirm, setConfirm] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);

  return (
    <>
      <PageHeader title="UI kit" subtitle="Every TOS v3 component, in the current theme. Switch theme from your account menu. All data here is sample data."
        actions={<Badge tone="primary">Design system v3</Badge>} />

      <Tabs defaultValue="foundations">
        <TabsList className="mb-6">
          {[["foundations", "Foundations"], ["forms", "Forms"], ["overlays", "Overlays"], ["data", "Data"], ["flow", "Flow & states"]].map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="foundations" className="space-y-6">
          <Section title="Colour tokens" description="Components use these names, never raw colours. Red is only for danger and the logo.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {SWATCHES.map(([name, cls]) => (
                <div key={name}><div className={`h-14 rounded-lg border border-border ${cls}`} /><div className="mt-1.5 text-xs font-medium">{name}</div></div>
              ))}
            </div>
            <h3 className="mb-2 mt-6 text-xs font-semibold text-muted-foreground">Chart series, in fixed order (validated for colour-blind safety in both themes)</h3>
            <div className="flex flex-wrap gap-2">{SERIES.map((c, i) => <div key={c} className="flex items-center gap-1.5 text-xs"><span className={`size-5 rounded-md ${c}`} />{i + 1}</div>)}</div>
          </Section>

          <Section title="Type">
            <div className="space-y-3">
              <div className="font-display text-[26px] font-bold leading-tight">Page title · Archivo 26</div>
              <div className="text-base font-semibold">Section title · Plex Sans 16 semibold</div>
              <div className="text-sm">Body text · Plex Sans 14. Plain words, short sentences, one idea per line.</div>
              <div className="text-sm text-muted-foreground">Secondary text for descriptions and hints.</div>
              <div className="text-[28px] font-semibold tracking-tight">{money(5_000_000, { compact: true })} <span className="text-sm font-medium text-muted-foreground">headline number</span></div>
              <div className="num text-sm">1,234.5 · 12,34,567 · 98% <span className="font-sans text-muted-foreground">— tabular figures for table columns</span></div>
            </div>
          </Section>

          <Section title="Buttons" description="One primary button per screen. Secondary for the rest; ghost in toolbars; danger only to delete.">
            <div className="flex flex-wrap items-center gap-2">
              <Button><Plus /> Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="soft">Soft</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger"><Trash2 /> Delete</Button>
              <Button variant="danger-ghost">Remove</Button>
              <Button variant="link">Link button</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button><Button>Medium</Button><Button size="lg">Large</Button>
              <Button busy>Saving…</Button><Button disabled>Disabled</Button>
              <Tip content="Copy link"><Button variant="secondary" size="icon" aria-label="Copy link"><Copy /></Button></Tip>
              <Tip content="Edit"><Button variant="ghost" size="icon-sm" aria-label="Edit"><Pencil /></Button></Tip>
            </div>
          </Section>

          <Section title="Badges and status" description="A status always has an icon and a word, never colour alone.">
            <div className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge><Badge tone="primary">Primary</Badge><Badge tone="success" dot>Active</Badge><Badge tone="warning" dot>Pending</Badge>
              <Badge tone="danger" dot>Overdue</Badge><Badge tone="info">Info</Badge><Badge tone="outline">Outline</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill status="good">On target</StatusPill><StatusPill status="warning">Near</StatusPill><StatusPill status="danger">Behind</StatusPill>
              <StatusPill status="info">Learning mode</StatusPill><StatusPill status="neutral">No target</StatusPill>
            </div>
            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground"><AvatarGroup people={PEOPLE} max={3} /> Avatar group · <span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span> keys</div>
          </Section>

          <Section title="Alerts">
            <div className="space-y-3">
              <Alert tone="amber"><b>You haven't filled in today.</b> Today locks at midnight, in 5h 20m.</Alert>
              <Alert tone="green">Saved. Your plan for tomorrow is waiting for approval.</Alert>
              <Alert tone="blue">Week 1 is learning mode: your scores show, but you're not in the rankings yet.</Alert>
              <Alert>Couldn't save: the day is locked. Ask your supervisor for a correction.</Alert>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="forms">
          <Section title="Form controls" description="All controls are 36 px tall and line up in a row.">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Client or organisation" hint="Autocompletes from your pipeline in M5." required><Input placeholder="e.g. Bangladesh Bank" /></Field>
              <Field label="Search"><SearchInput placeholder="Search people, deals…" /></Field>
              <Field label="Activity" hint="Type to search; grouped by task type, with points.">
                <Combobox options={ACTIVITIES} value={activity} onChange={setActivity} placeholder="Choose an activity" searchPlaceholder="Search activities…" aria-label="Activity" />
              </Field>
              <Field label="Stage">
                <SimpleSelect value={stage} onValueChange={setStage} aria-label="Stage" options={[
                  { value: "lead", label: "Lead" }, { value: "qualified", label: "Qualified lead" }, { value: "opp", label: "Requirements shared" },
                  { value: "proposal", label: "Proposal submitted" }, { value: "won", label: "Won (work order)" }, { value: "lost", label: "Lost" }]} />
              </Field>
              <Field label="Next action date" hint="The team week starts on Saturday."><DatePicker value={day} onChange={setDay} aria-label="Next action date" /></Field>
              <Field label="Native select (dense tables only)"><NativeSelect defaultValue="b"><option value="a">Option A</option><option value="b">Option B</option></NativeSelect></Field>
              <Field label="Remarks" className="md:col-span-2" error="Say what you did, e.g. “Called 12 prospects, 2 interested”."><Textarea aria-invalid placeholder="What did you do in this hour?" /></Field>
            </div>
            <div className="mt-6 grid gap-5 border-t border-border pt-6 md:grid-cols-3">
              <Choice control={<Checkbox defaultChecked />} label="Copy forward from last week" description="Start next week's plan from this one." />
              <Choice control={<Switch defaultChecked />} label="Email me before the lock" description="A reminder at 9 pm if today is empty." />
              <RadioGroup defaultValue="team" aria-label="Leaderboard">
                <Choice control={<RadioGroupItem value="self" />} label="Self vs target only" />
                <Choice control={<RadioGroupItem value="team" />} label="Team goal" />
              </RadioGroup>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="overlays">
          <Section title="Dialogs, drawers, menus" description="All close with Esc, trap focus while open and return it afterwards.">
            <div className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Log a win</DialogTitle><DialogDescription>Your supervisor verifies it, then the team celebrates.</DialogDescription></DialogHeader>
                  <DialogBody className="space-y-4">
                    <Field label="Client"><Input placeholder="Client name" /></Field>
                    <Field label="Work order value (BDT)"><Input inputMode="numeric" placeholder="e.g. 12,00,000" /></Field>
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <DialogClose asChild><Button onClick={() => toast.success("Win submitted", { description: "Your supervisor will verify it." })}><Send /> Submit for verification</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button variant="danger-ghost" onClick={() => setConfirm(true)}><Trash2 /> Confirm dialog</Button>
              <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this sheet?" confirmLabel="Delete sheet"
                description="All its days and KPIs are deleted too. A snapshot is saved first, so an admin can restore it."
                onConfirm={() => new Promise((r) => setTimeout(r, 800)).then(() => toast.success("Sheet deleted", { description: "A snapshot was saved first." }))} />

              <Sheet>
                <SheetTrigger asChild><Button variant="secondary">Open drawer</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader><SheetTitle>Bangladesh Bank · ERP</SheetTitle><SheetDescription>Requirements shared · BDT 45 L · Owner: Nadia</SheetDescription></SheetHeader>
                  <SheetBody>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly status</h3>
                    <Timeline items={[
                      { id: 1, title: "Requirements shared", time: "Week 45", description: "They sent the RFP; demo on Thursday.", tone: "primary", icon: <Briefcase /> },
                      { id: 2, title: "Qualified lead", time: "Week 43", description: "Budget and timeline confirmed with the IT head.", tone: "success" },
                      { id: 3, title: "First call", time: "Week 41", tone: "neutral" },
                    ]} />
                  </SheetBody>
                  <SheetFooter><SheetClose asChild><Button variant="secondary">Close</Button></SheetClose><Button>Update deal</Button></SheetFooter>
                </SheetContent>
              </Sheet>

              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary" aria-label="More actions"><MoreHorizontal /> Menu</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem><Pencil /> Edit<DropdownMenuShortcut>E</DropdownMenuShortcut></DropdownMenuItem>
                  <DropdownMenuItem><Copy /> Duplicate</DropdownMenuItem>
                  <DropdownMenuItem><Download /> Download Excel</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger"><Trash2 /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild><Button variant="secondary">Popover</Button></PopoverTrigger>
                <PopoverContent>
                  <div className="text-sm font-semibold">What counts as a qualified lead?</div>
                  <p className="mt-1 text-sm text-muted-foreground">The client has shown interest and you've confirmed the decision maker, budget, timeline and need.</p>
                </PopoverContent>
              </Popover>

              <Tip content="Tooltips explain icons and short labels"><Button variant="secondary">Tooltip</Button></Tip>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-6">
              <Button variant="secondary" onClick={() => toast.success("Saved", { description: "H-3 Cold calling · 5 points added" })}>Success toast</Button>
              <Button variant="secondary" onClick={() => toast.error("Couldn't save", { description: "The day is locked." })}>Error toast</Button>
              <Button variant="secondary" onClick={() => toast("Prospect archived", { action: { label: "Undo", onClick: () => toast.success("Restored") } })}>Toast with undo</Button>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Team hours this week" icon={<Clock />} value={num(156)} target={num(200)} progress={{ value: 156, max: 200 }}
              delta={{ value: 12, text: signed(12, 0, " h"), label: "vs last week" }} trend={[120, 132, 128, 141, 144, 156]} />
            <StatCard label="Points this month" icon={<Star />} value={num(957)} target={num(1200)} progress={{ value: 957, max: 1200 }}
              delta={{ value: -4, text: signed(-4, 0, "%"), label: "vs last month" }} trend={[880, 990, 1010, 940, 1000, 957]} />
            <StatCard label="Qualified leads" icon={<Target />} value="18" target="15" progress={{ value: 18, max: 15, tone: "success" }}
              footer={<StatusPill status="good">Target met</StatusPill>} />
            <StatCard label="Revenue this month (BDT)" icon={<Coins />} value={money(4_250_000, { compact: true, currency: null })}
              target={money(6_000_000, { compact: true, currency: null })} progress={{ value: 4.25, max: 6 }} footer={`${pct(4.25 / 6)} of target`} />
          </div>
          <Charts />
          <DataTable label="Team status (sample)" columns={COLUMNS} data={PEOPLE} getRowId={(p) => p.id} searchPlaceholder="Search people…"
            exportName="team-status-sample" loading={tableLoading} initialSorting={[{ id: "hours", desc: true }]}
            onRowClick={(p) => toast(`Open ${p.name}`, { description: "In M2 this opens the person drawer." })}
            toolbar={<Button variant="ghost" size="sm" onClick={() => { setTableLoading(true); setTimeout(() => setTableLoading(false), 1200); }}>Show loading</Button>} />
        </TabsContent>

        <TabsContent value="flow" className="space-y-6">
          <Section title="Step tracker" description="Where an item is and who it waits on (SRS FR-G4).">
            <StepTracker steps={[{ label: "Draft", state: "done" }, { label: "Submitted", state: "done" }, { label: "Approved", state: "waiting" },
              { label: "Logged", state: "upcoming" }, { label: "Scored", state: "upcoming" }]} note="Waiting for supervisor approval since 10:40" />
          </Section>

          <Section title="Progress" description="Rings for today, week and month (SRS FR-MO1). Green only once a target is met.">
            <div className="flex flex-wrap items-center gap-8">
              {([["Today", 6, 8, "h"], ["This week", 34, 40, "h"], ["This month", 168, 160, "h"]] as const).map(([l, v, m, u]) => (
                <div key={l} className="flex items-center gap-3">
                  <ProgressRing value={v} max={m} tone={v >= m ? "success" : "primary"} label={`${l}: ${v} of ${m} hours`}>
                    <span className="text-sm font-semibold">{Math.round((v / m) * 100)}%</span>
                  </ProgressRing>
                  <div><div className="text-sm font-semibold">{l}</div><div className="text-xs text-muted-foreground">{v} of {m} {u}</div></div>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Progress value={62} label="Primary" /><Progress value={100} tone="success" label="Success" />
              <Progress value={45} tone="warning" label="Warning" /><Progress value={20} tone="danger" label="Danger" />
            </div>
          </Section>

          <Section title="Pipeline board" description="Columns and cards; drag and drop arrives in M2.">
            <KanbanBoard>
              <KanbanColumn title="Qualified lead" count={2} summary="BDT 32 L" color="var(--chart-1)">
                <KanbanCard title="Bangladesh Bank" subtitle="ERP · Tender" value="BDT 20 L" due="Today" dueTone="warning" healthState="good" owner={{ name: "Nadia Rahman" }} onClick={() => undefined} />
                <KanbanCard title="Walton Group" subtitle="HRM · Corporate" value="BDT 12 L" due="3 days overdue" dueTone="danger" healthState="danger" owner={{ name: "Arif Hossain" }} onClick={() => undefined} />
              </KanbanColumn>
              <KanbanColumn title="Requirements shared" count={1} summary="BDT 45 L" color="var(--chart-2)">
                <KanbanCard title="BRAC" subtitle="School management" value="BDT 45 L" due="Thu" healthState="warning" owner={{ name: "Sadia Karim" }}
                  tags={<><Badge tone="outline">Demo booked</Badge></>} onClick={() => undefined} />
              </KanbanColumn>
              <KanbanColumn title="Proposal submitted" count={0} color="var(--chart-3)">
                <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-input px-4 py-6 text-center text-xs text-muted-foreground">Drag a deal here once the proposal is sent.</div>
              </KanbanColumn>
            </KanbanBoard>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <EmptyState icon={<Inbox />} title="No prospects yet" action={<Button><Plus /> Add your first prospect</Button>} secondary={<Button variant="secondary">Import a CSV</Button>}>
                Every company you contact goes here. Add one and TOS reminds you when to follow up.
              </EmptyState>
            </div>
            <div className="card"><ErrorState error={new Error("The server didn't answer in time.")} onRetry={() => toast("Retrying…")} /></div>
          </div>

          <Section title="Skeletons" description="Shown while data loads, in the shape of what's coming.">
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="rounded-lg border border-border p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-6 w-24" /><Skeleton className="mt-3 h-1.5 w-full" /></div>)}
            </div>
          </Section>

          <Section title="Plain-language gap" description="Every metric says what it means and what to do (SRS FR-G5).">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary-soft px-4 py-3">
              <p className="text-sm text-primary-text"><b>You need 6 more output hours this week</b> — about 1 hour per working day.</p>
              <Button size="sm"><CalendarCheck2 /> Plan tomorrow</Button>
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}
