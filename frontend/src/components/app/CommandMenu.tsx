import { Keyboard, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { actionsFor, navFor } from "@/lib/nav";
import { useTheme } from "@/lib/theme";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { useShell } from "./shell";

/** Ctrl/⌘ K: jump to any page or run an action by typing a few letters. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { resolved, toggle } = useTheme();
  const shell = useShell();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!user) return null;
  const run = (fn: () => void) => { onOpenChange(false); fn(); };
  const dark = resolved === "dark";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search pages and actions"
      footer={<>
        <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
        <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
      </>}>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No pages or actions match.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          {actionsFor(user.role).map((a) => (
            <CommandItem key={a.id} value={`${a.label} ${a.description}`} onSelect={() => run(() => navigate(a.to))}>
              <a.icon /><span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {navFor(user.role).map((s) => (
          <CommandGroup key={s.id} heading={s.title}>
            {s.items.map((i) => (
              <CommandItem key={i.to} value={`${i.label} ${i.keywords ?? ""} ${s.title}`} onSelect={() => run(() => navigate(i.to))}>
                <i.icon /><span>{i.label}</span>
                <span className="ml-auto hidden truncate pl-3 text-xs text-muted-foreground sm:block">{i.description}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="Account">
          <CommandItem value="my profile account photo" onSelect={() => run(() => navigate("/profile"))}><UserRound /><span>My profile</span></CommandItem>
          <CommandItem value="theme dark light mode appearance" onSelect={() => run(toggle)}>
            {dark ? <Sun /> : <Moon />}<span>Switch to {dark ? "light" : "dark"} mode</span>
          </CommandItem>
          <CommandItem value="keyboard shortcuts help" onSelect={() => run(shell.openShortcuts)}><Keyboard /><span>Keyboard shortcuts</span></CommandItem>
          <CommandItem value="sign out log out" onSelect={() => run(() => void signOut())}><LogOut /><span>Sign out</span></CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
