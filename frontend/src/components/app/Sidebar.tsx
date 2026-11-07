import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound } from "lucide-react";
import { Link, useMatch, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { navFor, type BadgeKey, type NavItem } from "@/lib/nav";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Avatar, BrandName, LogoMark } from "../Brand";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tip } from "../ui/tooltip";
import { useShell } from "./shell";

type Badges = Partial<Record<BadgeKey, number>>;

function SideLink({ item, collapsed, count, onNavigate }: { item: NavItem; collapsed: boolean; count?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  // Worked out here rather than with NavLink's className function: the tooltip wrapper (Radix Slot) merges classes as strings.
  const active = !!useMatch({ path: item.to, end: false });
  const link = (
    <Link to={item.to} onClick={onNavigate} aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (count ? `${item.label}, ${count} waiting` : item.label) : undefined}
      className={cn("relative flex h-9 items-center gap-3 rounded-lg text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center" : "px-3",
        active ? "bg-primary-soft text-primary-text" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!!count && (collapsed
        ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" aria-hidden />
        : <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold text-primary-foreground">{count}</span>)}
    </Link>
  );
  return collapsed ? <Tip content={count ? `${item.label} (${count})` : item.label} side="right">{link}</Tip> : link;
}

function UserMenu({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const shell = useShell();
  const { pref, setPref } = useTheme();
  if (!user) return null;
  const name = user.name || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Account: ${name}`}
          className={cn("flex w-full items-center gap-3 rounded-lg p-1.5 text-left outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
            collapsed && "justify-center")}>
          <Avatar name={name} src={user.profile.photo_url} size="sm" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                <span className="block truncate text-xs text-muted-foreground"><span className="capitalize">{user.role}</span>{user.profile.position ? ` · ${user.profile.position}` : ""}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-64">
        <div className="px-2 py-1.5">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { onNavigate?.(); navigate("/profile"); }}><UserRound /> My profile</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => shell.openShortcuts()}><Keyboard /> Keyboard shortcuts<DropdownMenuShortcut>?</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <DropdownMenuRadioItem value="light"><Sun /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor /> Same as my computer</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The main menu. On desktop it can collapse to icons; on phones it opens as a drawer (without the collapse button). */
export function Sidebar({ collapsed = false, onToggle, onNavigate, badges, inDrawer }: {
  collapsed?: boolean; onToggle?: () => void; onNavigate?: () => void; badges: Badges; inDrawer?: boolean;
}) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "gap-2.5 px-4", inDrawer && "pr-12")}>
        <LogoMark />
        {!collapsed && <BrandName compact />}
      </div>
      <nav aria-label="Main" className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
        {navFor(user.role).map((s, si) => (
          <div key={s.id} className="mb-5 last:mb-0">
            {collapsed
              ? si > 0 && <div className="mx-2 mb-3 h-px bg-border" aria-hidden />
              : <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{s.title}</div>}
            <ul className="space-y-0.5">
              {s.items.map((i) => <li key={i.to}><SideLink item={i} collapsed={collapsed} count={i.badge ? badges[i.badge] : undefined} onNavigate={onNavigate} /></li>)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-border p-2">
        {onToggle && (
          <Tip content={collapsed ? "Expand sidebar" : undefined} side="right">
            <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("flex h-8 w-full items-center gap-3 rounded-lg text-[13px] font-medium text-muted-foreground outline-hidden transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "justify-center" : "px-3")}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
            </button>
          </Tip>
        )}
        <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
