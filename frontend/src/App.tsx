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
// Screens on sample data, for checking the output and the look before they're connected. Also never in the built site.
const PREVIEW = import.meta.env.DEV ? [
  { path: "/preview", Page: lazy(() => import("./features/preview/PreviewHub")) },
  { path: "/preview/onboarding", Page: lazy(() => import("./features/preview/Onboarding")) },
  { path: "/preview/role-dashboards", Page: lazy(() => import("./features/preview/RoleDashboards")) },
  { path: "/preview/reports", Page: lazy(() => import("./features/preview/Reports")) },
  { path: "/preview/notifications", Page: lazy(() => import("./features/preview/NotificationsAndPhone")) },
  { path: "/preview/configuration", Page: lazy(() => import("./features/preview/ConfigAndLeave")) },
] : [];
const MyDay = lazy(() => import("./features/myday/MyDay"));
const MyTasks = lazy(() => import("./features/mytasks/MyTasks"));
const TeamBoard = lazy(() => import("./features/board/TeamBoard"));
const FrameworkStudio = lazy(() => import("./features/frameworks/FrameworkStudio"));
const Playbook = lazy(() => import("./features/playbook/Playbook"));
const MyProgress = lazy(() => import("./features/progress/MyProgress"));
const WinFeed = lazy(() => import("./features/recognition/WinFeed"));
const WeeklyReview = lazy(() => import("./features/progress/WeeklyReview"));
const TeamReview = lazy(() => import("./features/progress/TeamReview"));

/** The page was called Sheets, then Daily log; old links and bookmarks still work (SRS v0.5 FR-G5: My Day). */
function ToMyDay() {
  const { search } = useLocation();
  return <Navigate to={`/my-day${search}`} replace />;
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

/** Supervisors and admins approve plans and hours (SRS v0.5 §3). */
function RequireApprover() {
  const { user } = useAuth();
  return user?.role === "admin" || user?.role === "supervisor" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

/** SRS v0.5 §5.8: the Daily Playbook is home for people who do the work; management goes to the Dashboard. */
function HomeRoute() {
  const { user } = useAuth();
  return user?.role === "viewer" ? <Navigate to="/dashboard" replace /> : <Playbook />;
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
          <Route path="/home" element={<Suspense fallback={<PageSkeleton />}><HomeRoute /></Suspense>} />
          <Route path="/wins" element={<Suspense fallback={<PageSkeleton />}><WinFeed /></Suspense>} />
          <Route path="/my-progress" element={<Suspense fallback={<PageSkeleton />}><MyProgress /></Suspense>} />
          <Route path="/weekly-review" element={<Suspense fallback={<PageSkeleton />}><WeeklyReview /></Suspense>} />
          <Route path="/team-review" element={<Suspense fallback={<PageSkeleton />}><TeamReview /></Suspense>} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/huddle" element={<Suspense fallback={<PageSkeleton />}><Huddle /></Suspense>} />
          <Route path="/renewals" element={<Suspense fallback={<PageSkeleton />}><Renewals /></Suspense>} />
          <Route path="/my-day" element={<Suspense fallback={<PageSkeleton />}><MyDay /></Suspense>} />
          <Route path="/my-tasks" element={<Suspense fallback={<PageSkeleton />}><MyTasks /></Suspense>} />
          <Route path="/log" element={<ToMyDay />} />
          <Route path="/sheets" element={<ToMyDay />} />
          <Route element={<RequireApprover />}>
            <Route path="/team-board" element={<Suspense fallback={<PageSkeleton />}><TeamBoard /></Suspense>} />
            <Route path="/frameworks" element={<Suspense fallback={<PageSkeleton />}><FrameworkStudio /></Suspense>} />
          </Route>
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
            {PREVIEW.map(({ path, Page }) => <Route key={path} path={path} element={<Suspense fallback={<PageSkeleton />}><Page /></Suspense>} />)}
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
