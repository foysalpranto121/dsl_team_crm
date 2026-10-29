import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { User } from "./types";

/* The access token lives only in memory. The refresh token is an httpOnly cookie the page can't read;
   when the access token expires, one refresh request gets a new one and the failed call is retried. */
let accessToken: string | null = null;
let onRefreshed: (u: User) => void = () => {};
let onSignedOut: () => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function bindSession(handlers: { refreshed: (u: User) => void; signedOut: () => void }) {
  onRefreshed = handlers.refreshed;
  onSignedOut = handlers.signedOut;
}

export const api = axios.create({ baseURL: "/api", withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing: Promise<User | null> | null = null;
export function refreshSession(): Promise<User | null> {
  refreshing ??= axios
    .post("/api/auth/refresh/", null, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.access);
      onRefreshed(r.data.user);
      return r.data.user as User;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(undefined, async (err: AxiosError) => {
  const cfg = err.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  if (err.response?.status === 401 && cfg && !cfg._retried && !cfg.url?.startsWith("/auth/")) {
    cfg._retried = true;
    if (await refreshSession()) return api(cfg);
    onSignedOut();
  }
  throw err;
});

/** Download a file from the API (the access token goes in the header, so a plain link can't be used). */
export async function downloadFile(url: string, fallbackName: string) {
  const r = await api.get<Blob>(url, { responseType: "blob" });
  const disposition = String(r.headers["content-disposition"] ?? "");
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(r.data);
  const a = Object.assign(document.createElement("a"), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

/** A short, human message for any API error. */
export function errorText(e: unknown): string {
  if (!axios.isAxiosError(e)) return String(e);
  const data = e.response?.data as Record<string, unknown> | undefined;
  if (!e.response) return "Can't reach the server. Is the backend running?";
  if (data && typeof data.detail === "string") return data.detail;
  if (data && typeof data === "object") {
    const [field, msg] = Object.entries(data)[0] ?? [];
    const text = Array.isArray(msg) ? msg[0] : msg;
    if (text) return field === "non_field_errors" ? String(text) : `${field.replace(/_/g, " ")}: ${text}`;
  }
  return `Something went wrong (${e.response.status}).`;
}
