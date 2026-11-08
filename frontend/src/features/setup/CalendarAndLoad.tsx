import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { TeamSettings } from "@/api/types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { date } from "@/lib/format";

/** Team setup → Holidays (SRS v0.5 FR-C2: framework steps skip weekends and holidays) and the Overloaded limits (FR-SF6, D6). */
export function CalendarAndLoad({ st }: { st: TeamSettings }) {
  const qc = useQueryClient();
  const [day, setDay] = useState<string | null>(null);
  const [lim, setLim] = useState({ items: st.overload_items, days: st.overload_days });
  useEffect(() => setLim({ items: st.overload_items, days: st.overload_days }), [st.overload_items, st.overload_days]);
  const save = useMutation({
    mutationFn: async (patch: Partial<TeamSettings>) => (await api.patch<TeamSettings>("/team/settings/", patch)).data,
    onSuccess: () => { ["team-settings", "frameworks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Saved"); },
    onError: (e) => toast.error("Couldn't save", { description: errorText(e) }),
  });
  const holidays = st.holidays ?? [];
  const upcoming = holidays.filter((h) => h >= st.today);
  const past = holidays.length - upcoming.length;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5" aria-labelledby="holidays-title">
        <h2 id="holidays-title" className="text-base font-semibold">Holidays</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Days nobody works, as well as the weekend. Framework steps never fall on them.</p>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (day) save.mutate({ holidays: [...holidays, day] }, { onSuccess: () => setDay(null) }); }}>
          <Field label="Add a holiday"><DatePicker value={day} onChange={setDay} aria-label="Holiday date" /></Field>
          <Button type="submit" variant="secondary" disabled={!day || holidays.includes(day)} busy={save.isPending}>Add</Button>
        </form>
        {upcoming.length ? (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Upcoming holidays">
            {upcoming.map((h) => (
              <li key={h} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card pl-2.5 pr-1 text-xs tabular-nums">
                {date(h, "medium")}
                <button type="button" onClick={() => save.mutate({ holidays: holidays.filter((x) => x !== h) })} aria-label={`Remove ${date(h, "medium")}`}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>
              </li>))}
          </ul>
        ) : <p className="mt-4 text-sm text-muted-foreground">No holidays coming up.</p>}
        {past > 0 && <p className="mt-2 text-xs text-muted-foreground">{past} past {past === 1 ? "holiday is" : "holidays are"} kept, so older step dates still make sense.</p>}
      </section>

      <section className="card p-5" aria-labelledby="load-limits-title">
        <h2 id="load-limits-title" className="text-base font-semibold">Overloaded members</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">There's no daily limit on steps; unfinished ones carry over. A member is flagged Overloaded when their overdue
          framework steps and tasks pass either limit. Their new steps then wait until they catch up, and the flag clears by itself.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ overload_items: lim.items, overload_days: lim.days }); }}>
          <Field label="More overdue items than" hint="Default 10">
            <Input type="number" min={1} max={500} inputMode="numeric" value={lim.items} onChange={(e) => setLim({ ...lim, items: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <Field label="Or the oldest waiting more than (working days)" hint="Default 5">
            <Input type="number" min={1} max={60} inputMode="numeric" value={lim.days} onChange={(e) => setLim({ ...lim, days: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <div className="sm:col-span-2"><Button type="submit" busy={save.isPending} disabled={lim.items === st.overload_items && lim.days === st.overload_days}>Save limits</Button></div>
        </form>
      </section>
    </div>
  );
}
