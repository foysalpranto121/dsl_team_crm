import { Fragment } from "react";
import { modKey } from "@/lib/utils";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Kbd } from "../ui/kbd";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  { title: "Everywhere", keys: [[[modKey, "K"], "Search pages and actions"], [["?"], "Show these shortcuts"], [["Esc"], "Close a dialog, menu or drawer"]] },
  { title: "Lists, menus and tables", keys: [[["↑", "↓"], "Move between items"], [["Enter"], "Open the selected item or row"], [["Tab"], "Go to the next control"]] },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything in TOS works without a mouse.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {g.keys.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <dt className="text-foreground">{what}</dt>
                    <dd className="flex items-center gap-1">{keys.map((k, i) => <Fragment key={k}>{i > 0 && <span className="text-xs text-subtle-foreground">+</span>}<Kbd>{k}</Kbd></Fragment>)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
