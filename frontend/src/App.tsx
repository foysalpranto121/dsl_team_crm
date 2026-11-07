import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./auth/AuthContext";
import { BootScreen } from "./components/app/BootScreen";
import Layout from "./components/Layout";
import ProfileForm from "./components/ProfileForm";
import { Card, PageHeader } from "./components/ui";
import { PageSkeleton } from "./components/ui/skeleton";
import ActivityLog from "./pages/ActivityLog";
import Approvals from "./pages/Approvals";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import KpiPage from "./pages/Kpi";
import People from "./pages/People";
import Performance from "./pages/Performance";
import TeamPipelines from "./pages/TeamPipelines";
import TeamSetup from "./pages/TeamSetup";
import Tracker from "./pages/Tracker";

// Loaded on demand so they never weigh on everyone else's download: the admin-only component showcase,
// and Office TV mode (SRS v0.3 §14.5) — the public TV page and its admin settings.
// The component showcase is a developer tool: only in `npm run dev`, never in the built site.
const UiKit = import.meta.env.DEV ? lazy(() => import("./pages/UiKit")) : null;
const DailyLog = lazy(() => import("./features/log/DailyLog"));

/** The page used to be called Sheets; old links and bookmarks still work. */
function ToDailyLog() {
  const { search } = useLocation();
  return <Navigate to={`/log${search}`} replace />;
}
const TvDisplay = lazy(() => import("./features/tv/TvDisplay"));
const TvScreens = lazy(() => import("./features/tv/TvScreens"));
// Team and management tools (SRS v0.3 §14.9): morning huddle and weekly digest.
const Huddle = lazy(() => import("./features/huddle/Huddle"));
const WeeklyDigest = lazy(() => import("./features/digest/WeeklyDigest"));
const Renewals = lazy(() => import("./features/renewals/Renewals"));
import Waiting from "./pages/Waiting";
import Welcome from "./pages/Welcome";

/** Signed in and approved, or sent to sign in (and brought back here afterwards). */
function RequireUser() {
  const { session } = useAuth();
  const location = useLocation();
  if (session.phase === "loading") return <BootScreen waking={session.waking} />;
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
      {/* A TV signs in with its screen link, never with a person's account, so this page sits outside RequireUser. */}
      <Route path="/tv" element={<Suspense fallback={<BootScreen />}><TvDisplay /></Suspense>} />
      <Route element={<RequireUser />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route element={<RequireProfile><Layout /></RequireProfile>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/huddle" element={<Suspense fallback={<PageSkeleton />}><Huddle /></Suspense>} />
          <Route path="/renewals" element={<Suspense fallback={<PageSkeleton />}><Renewals /></Suspense>} />
          <Route path="/log" element={<Suspense fallback={<PageSkeleton />}><DailyLog /></Suspense>} />
          <Route path="/sheets" element={<ToDailyLog />} />
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
            <Route path="/admin/tv" element={<Suspense fallback={<PageSkeleton />}><TvScreens /></Suspense>} />
            <Route path="/admin/digest" element={<Suspense fallback={<PageSkeleton />}><WeeklyDigest /></Suspense>} />
            {UiKit && <Route path="/ui" element={<Suspense fallback={<PageSkeleton />}><UiKit /></Suspense>} />}
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
