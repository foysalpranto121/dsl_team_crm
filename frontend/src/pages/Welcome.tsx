import { Navigate, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { BrandName, Logo, ThemeToggle } from "../components/Brand";
import ProfileForm from "../components/ProfileForm";

/** First sign-in after approval: complete the profile before using the app. */
export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (user?.profile.is_complete) return <Navigate to="/dashboard" replace />;
  const first = (user?.name || "").split(" ")[0];
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5 sm:px-6"><Logo /><BrandName /><div className="ml-auto"><ThemeToggle /></div></header>
      <main className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <div className="card p-6 sm:p-8">
          <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">You're approved{first ? `, ${first}` : ""} 🎉</p>
          <h1 className="mt-1 text-2xl font-extrabold">Set up your profile</h1>
          <p className="mb-8 mt-1 text-sm text-slate-500 dark:text-slate-400">Your team sees this on the People page. Fields marked * are needed to continue.</p>
          <ProfileForm submitLabel="Save and continue" onSaved={(u) => u.profile.is_complete && navigate("/dashboard", { replace: true })} />
        </div>
      </main>
    </div>
  );
}
