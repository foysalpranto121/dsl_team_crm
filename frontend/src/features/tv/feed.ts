import type { Feed } from "./types";

/** The link was turned off or replaced: stop polling and say so. */
export class ScreenLinkError extends Error {}

/** One read of the TV feed. Uses fetch, not the app's axios client: a TV has no person's sign-in, only the screen token. */
export async function fetchFeed(token: string): Promise<Feed> {
  const r = await fetch("/api/display/feed/", { headers: { "X-Display-Token": token, Accept: "application/json" }, cache: "no-store" });
  if (r.status === 401 || r.status === 403) {
    const body = await r.json().catch(() => null);
    throw new ScreenLinkError(body?.detail ?? "This screen's link was turned off or replaced. Ask an admin for the new link.");
  }
  if (!r.ok) throw new Error(`The server answered ${r.status}.`);
  return r.json() as Promise<Feed>;
}
