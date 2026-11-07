import { useSyncExternalStore } from "react";

/** Light, dark, or follow the computer. Saved in localStorage as "theme" ("light" | "dark"; nothing saved = system),
    the same key index.html reads before first paint so the page never flashes the wrong theme. */
export type ThemePref = "light" | "dark" | "system";

const KEY = "theme";
const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref: ThemePref = typeof window === "undefined" ? "system" : readPref();

function apply() {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* private mode: the choice just isn't remembered */ }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = media();
  const onSystem = () => { if (pref === "system") { apply(); cb(); } };
  mq.addEventListener("change", onSystem);
  return () => { listeners.delete(cb); mq.removeEventListener("change", onSystem); };
}

const snapshot = () => `${pref}|${document.documentElement.classList.contains("dark") ? "dark" : "light"}`;

export function useTheme() {
  const [p, resolved] = useSyncExternalStore(subscribe, snapshot, () => "system|light").split("|") as [ThemePref, "light" | "dark"];
  return { pref: p, resolved, setPref: setThemePref, toggle: () => setThemePref(resolved === "dark" ? "light" : "dark") };
}
