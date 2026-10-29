import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import ProfileForm from "./components/ProfileForm";
import { Card, PageHeader, Spinner } from "./components/ui";
import Approvals from "./pages/Approvals";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import People from "./pages/People";
import Performance from "./pages/Performance";
import Sheets from "./pages/Sheets";
import Soon from "./pages/Soon";
import TeamSetup from "./pages/TeamSetup";
import Waiting from "./pages/Waiting";
import Welcome from "./pages/Welcome";

/** Signed in and approved, or sent to sign in (and brought back here afterwards). */
function RequireUser() {
  const { session } = useAuth();
  const location = useLocation();
  if (session.phase === "loading") return <div className="grid min-h-dvh place-items-center"><Spinner label="Loading your workspace…" /></div>;
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
          <Route path="/kpi" element={<Soon title="Weekly KPI" text="Enter this week's leads, opportunities, clients and revenue. The API for it is ready." />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/team" element={<People />} />
          <Route path="/tracker" element={<Soon title="My pipeline & plan" text="Your private prospects, follow-ups, daily plan and activity log, with your own product and targets." />} />
          <Route path="/profile" element={<MyProfile />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/approvals" element={<Approvals />} />
            <Route path="/admin/settings" element={<TeamSetup />} />
            <Route path="/admin/activity" element={<Soon title="Activity log" text="Every change with who and when, with admin corrections to locked days highlighted." />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
