import { GoogleOAuthProvider } from "@react-oauth/google";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {clientId ? (
      <GoogleOAuthProvider clientId={clientId} locale="en">
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider><App /></AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </GoogleOAuthProvider>
    ) : (
      <p style={{ padding: 24, fontFamily: "system-ui" }}>Add VITE_GOOGLE_CLIENT_ID to frontend/.env, then restart <code>npm run dev</code>.</p>
    )}
  </StrictMode>,
);
