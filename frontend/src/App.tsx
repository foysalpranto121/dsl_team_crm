import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import ProfileForm from "./components/ProfileForm";
import { Card, PageHeader, Spinner } from "./components/ui";
import ActivityLog from "./pages/ActivityLog";
import Approvals from "./pages/Approvals";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import KpiPage from "./pages/Kpi";
import People from "./pages/People";
import Performance from "./pages/Performance";
import Sheets from "./pages/Sheets";
import TeamPipelines from "./pages/TeamPipelines";
import TeamSetup from "./pages/TeamSetup";
import Tracker from "./pages/Tracker";
import Waiting from "./pages/Waiting";
import Welcome from "./pages/Welcome";

/** Signed in and approved, or sent to sign in (and brought back here afterwards). */
function RequireUser() {
  const { session } = useAuth();
  const location = useLocation();
  if (session.phase === "loading") return <div className="grid min-h-dvh place-items-center">
    <Spinner label={session.waking ? "Waking up the server… this can take up to a minute after a quiet spell." : "Loading your workspace…"} /></div>;
  if (session.phase === "waiting") return <Navigate to="/waiting" replace />;
  if (session.phase === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function RequireProfile({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.profile.is_complete ? <>{children}</> : <Navigate to="/welcome" replace />;
}

function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function MyProfile() {
  return (
    <>
      <PageHeader title="My profile" subtitle="What your team sees on the People page." />
      <Card className="p-6 sm:p-8"><ProfileForm submitLabel="Save profile" /></Card>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Home />} />
      <Route path="/waiting" element={<Waiting />} />
      <Route element={<RequireUser />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route element={<RequireProfile><Layout /></RequireProfile>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/kpi" element={<KpiPage />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/team" element={<People />} />
          <Route path="/tracker" element={<Tracker />} />
          <Route path="/profile" element={<MyProfile />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/approvals" element={<Approvals />} />
            <Route path="/admin/settings" element={<TeamSetup />} />
            <Route path="/admin/activity" element={<ActivityLog />} />
            <Route path="/admin/pipelines" element={<TeamPipelines />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
