import { Clock3, ShieldX, UserX } from "lucide-react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { BrandName, Logo } from "../components/Brand";
import { Button } from "../components/ui";

export default function Waiting() {
  const { session, signOut } = useAuth();
  if (session.phase === "signedIn") return <Navigate to="/dashboard" replace />;
  if (session.phase !== "waiting") return <Navigate to="/login" replace />;

  const view = {
    pending: { icon: <Clock3 />, title: "Waiting for approval", text: "Your request has been sent to the team admins. You'll get an email as soon as you're approved. Then sign in again." },
    rejected: { icon: <ShieldX />, title: "Request not approved", text: "An admin didn't approve this request. If you think that's a mistake, contact your team admin." },
    disabled: { icon: <UserX />, title: "Access switched off", text: "Your access has been switched off by an admin. Contact your team admin if you need it back." },
  }[session.status];

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-3"><Logo /><BrandName /></div>
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-700 [&>svg]:size-7 dark:bg-amber-400/15 dark:text-amber-300">{view.icon}</div>
        <h1 className="text-xl font-extrabold">{view.title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{view.text}</p>
        <p className="mt-4 text-sm"><span className="text-slate-500">Signed in as </span><b>{session.email}</b></p>
        <Button variant="secondary" className="mt-6" onClick={signOut}>Use a different account</Button>
      </div>
    </div>
  );
}
