import { createContext, useContext } from "react";

/** Lets any part of the shell open the command palette, the shortcuts dialog or the phone menu. Provided by Layout. */
export interface Shell {
  openCommand: () => void;
  openShortcuts: () => void;
  openMobileNav: () => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside Layout");
  return shell;
}
