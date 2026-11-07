import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, errorText } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { Contracts } from "./Contracts";
import { Overview, summaryQuery } from "./Overview";
import { RenewalList } from "./RenewalList";
import { RenewalSheet } from "./RenewalWork";
import { KEY, type RenewalSettings } from "./types";

/** AMC and renewal tracker (SRS v0.3 §14.6): Overview (FR-RN3) · To renew (FR-RN2) · Contracts (FR-RN1). */

type Tab = "overview" | "renew" | "contracts";

function parseDays(text: string) {
  const days = text.split(/[\s,]+/).filter(Boolean).map(Number);
  const ok = days.length >= 1 && days.length <= 5 && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 365) && new Set(days).size === days.length;
  return ok ? [...days].sort((a, b) => b - a) : null;
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, "settings"], queryFn: async () => (await api.get<RenewalSettings>("/renewals/settings/")).data, enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {q.data ? <SettingsForm key={q.data.updated_at} s={q.data} onDone={() => { onOpenChange(false); qc.invalidateQueries({ queryKey: KEY }); }} onCancel={() => onOpenChange(false)} />
          : <DialogHeader><DialogTitle>Renewal reminders</DialogTitle><DialogDescription>{q.error ? errorText(q.error) : "Loading…"}</DialogDescription></DialogHeader>}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ s, onDone, onCancel }: { s: RenewalSettings; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(s.windows.join(", "));
  const [weight, setWeight] = useState(String(Math.round(+s.revenue_weight)));
  const windows = parseDays(days);
  const w = Number(weight);
  const weightOk = weight !== "" && Number.isFinite(w) && w >= 0 && w <= 100;
  const save = useMutation({
    mutationFn: async () => (await api.patch<RenewalSettings>("/renewals/settings/", { windows, revenue_weight: String(w) })).data,
    onSuccess: () => {
      ["dashboard", "kpi-week", "performance"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Renewal settings saved");
      onDone();
    },
    onError: (e) => toast.error("Couldn't save the settings", { description: errorText(e) }),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (windows && weightOk) save.mutate(); }}>
      <DialogHeader>
        <DialogTitle>Renewal reminders</DialogTitle>
        <DialogDescription>When renewals open, and how much renewal revenue counts. Changes apply to every contract at once.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-5">
        <Field label="Remind the owner this many days before a contract ends" required
          error={windows ? undefined : "Use 1 to 5 different numbers from 1 to 365, e.g. 90, 60, 30."}
          hint={windows ? `The renewal opens ${windows[0]} days before the end${windows.length > 1 ? ` and comes back on the owner's to-do list at ${windows.slice(1).join(" and ")} days` : ""}.` : undefined}>
          <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="90, 60, 30" />
        </Field>
        <Field label="Renewal revenue counted in the Revenue KPI (%)" required
          error={weightOk ? undefined : "Enter a number from 0 to 100."}
          hint="100% counts a renewal like new business. Lower it if renewals should weigh less in scores; 0% leaves them out.">
          <Input type="number" min={0} max={100} step={5} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={save.isPending} disabled={!windows || !weightOk}>Save</Button>
      </DialogFooter>
    </form>
  );
}

export default function Renewals() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const seesAll = isAdmin || user?.role === "viewer";
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? (seesAll ? "overview" : "renew");
  const openId = params.get("open") ? Number(params.get("open")) : null;
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const summary = useQuery(summaryQuery);
  const windows = summary.data?.windows ?? [90, 60, 30];
  const openCount = summary.data?.stages.reduce((a, x) => a + x.count, 0);

  const go = (next: Partial<Record<"tab" | "open", string | null>>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v)));
    setParams(p, { replace: true });
  };
  const openRenewal = (id: number) => go({ open: String(id) });
  const addContracts = () => { setAdding(true); go({ tab: "contracts" }); };
  // The Contracts tab reads `startAdding` once, when it mounts; after that the add sheet must not reopen by itself.
  useEffect(() => { if (adding && tab === "contracts") setAdding(false); }, [adding, tab]);

  return (
    <>
      <PageHeader title="Renewals"
        subtitle={seesAll ? "AMCs, licences and software: what ends soon, what's at risk, and who's on it."
          : "Your clients' AMCs and licences coming up for renewal, and the next step for each."}
        actions={isAdmin && <Button variant="secondary" onClick={() => setSettings(true)}><BellRing /> Reminders</Button>} />
      <Tabs value={tab} onValueChange={(v) => go({ tab: v })}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="renew">To renew{openCount ? <span className="num ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{openCount}</span> : null}</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview isAdmin={isAdmin} onOpen={openRenewal} onAddContracts={addContracts} /></TabsContent>
        <TabsContent value="renew">
          <RenewalList seesAll={seesAll} firstWindow={windows[0]} lastWindow={windows[windows.length - 1]} onOpen={openRenewal}
            onAddContracts={isAdmin ? addContracts : undefined} />
        </TabsContent>
        <TabsContent value="contracts"><Contracts isAdmin={isAdmin} seesAll={seesAll} onOpenRenewal={openRenewal} startAdding={adding} /></TabsContent>
      </Tabs>
      <RenewalSheet id={openId} lastWindow={windows[windows.length - 1]} onClose={() => go({ open: null })} />
      {isAdmin && <SettingsDialog open={settings} onOpenChange={setSettings} />}
    </>
  );
}
