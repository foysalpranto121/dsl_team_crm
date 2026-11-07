import { useCallback, useState } from "react";

/** useState that is remembered in this browser (sidebar collapsed, table density…). Falls back to plain state
    when storage is blocked, so the page always works. Only for per-person conveniences, never for real data. */
export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage blocked */ }
  }, [key]);
  return [value, set] as const;
}
