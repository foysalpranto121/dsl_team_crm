import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { actionsFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";

/** The global "New" menu (SRS FR-Q2): a button in the top bar, a round + in the phone tab bar. */
export function QuickAdd({ variant = "button", className }: { variant?: "button" | "fab"; className?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const fab = variant === "fab";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {fab ? (
          <button type="button" aria-label="New"
            className={cn("grid size-12 -translate-y-3 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background outline-hidden transition-transform active:scale-95 focus-visible:ring-ring", className)}>
            <Plus className="size-6" />
          </button>
        ) : (
          <Button size="sm" className={className}><Plus /> New</Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={fab ? "center" : "end"} side={fab ? "top" : "bottom"} className="w-72">
        <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
        {actionsFor(user.role).map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => navigate(a.to)} className="items-start py-2">
            <a.icon className="mt-0.5" />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{a.label}</span>
              <span className="block text-xs text-muted-foreground">{a.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
