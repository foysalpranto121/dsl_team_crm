import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets later Tailwind classes win over earlier ones (`cn("px-4", "px-2")` → `"px-2"`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** True when a key press happened inside a text field, so single-key shortcuts must not fire. */
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
