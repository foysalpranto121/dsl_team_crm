import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, bindSession, refreshSession, setAccessToken, wakeServer } from "../api/client";
import type { SignInResponse, Status, User } from "../api/types";

type Session =
  | { phase: "loading"; waking?: boolean }   // waking: the server was asleep and is starting up
  | { phase: "signedOut" }
  | { phase: "waiting"; status: Exclude<Status, "approved">; email: string; name: string }
  | { phase: "signedIn"; user: User };

interface AuthValue {
  session: Session;
  user: User | null;
  signInWithGoogle: (credential: string) => Promise<Session>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ phase: "loading" });

  useEffect(() => {
    bindSession({
      refreshed: (user) => setSession({ phase: "signedIn", user }),
      signedOut: () => setSession({ phase: "signedOut" }),
    });
    // Wake the server first: the refresh token is single-use, so that request must not be cut off and retried.
    // Then a returning visitor still has the refresh cookie: pick the session back up.
    wakeServer(() => setSession((s) => (s.phase === "loading" ? { phase: "loading", waking: true } : s)))
      .then(() => refreshSession())
      .then((u) => {
        if (!u) setSession((s) => (s.phase === "loading" ? { phase: "signedOut" } : s));
      });
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const { data } = await api.post<SignInResponse>("/auth/google/", { credential });
    let next: Session;
    if (data.status === "approved" && data.access && data.user) {
      setAccessToken(data.access);
      next = { phase: "signedIn", user: data.user };
    } else {
      next = { phase: "waiting", status: data.status as Exclude<Status, "approved">, email: data.email ?? "", name: data.name ?? "" };
    }
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout/");
    } finally {
      setAccessToken(null);
      setSession({ phase: "signedOut" });
    }
  }, []);

  const setUser = useCallback((user: User) => setSession({ phase: "signedIn", user }), []);

  const value = useMemo<AuthValue>(
    () => ({ session, user: session.phase === "signedIn" ? session.user : null, signInWithGoogle, signOut, setUser }),
    [session, signInWithGoogle, signOut, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
