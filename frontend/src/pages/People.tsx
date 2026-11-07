import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, Users } from "lucide-react";
import { api, errorText } from "../api/client";
import type { User } from "../api/types";
import { Avatar } from "../components/Brand";
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

export default function People() {
  const q = useQuery({ queryKey: ["directory"], queryFn: async () => (await api.get<User[]>("/team/directory/")).data });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{errorText(q.error)}</Alert>;
  return (
    <>
      <PageHeader title="People" subtitle={`${q.data!.length} people on the team`} />
      {!q.data!.length ? <Card><EmptyState icon={<Users />} title="No one here yet" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.map((u) => (
            <Card key={u.id} className="flex flex-col p-5">
              <div className="flex items-center gap-4">
                <Avatar name={u.name || u.email} src={u.profile.photo_url} size="lg" />
                <div className="min-w-0">
                  <div className="truncate font-bold">{u.name || u.email}</div>
                  <div className="truncate text-sm text-slate-500">{u.profile.position || "Team member"}</div>
                  {u.role !== "member" && <Badge tone={u.role === "admin" ? "brand" : "slate"} className="mt-1 capitalize">{u.role === "viewer" ? "Management" : u.role}</Badge>}
                </div>
              </div>
              {u.profile.bio && <p className="mt-4 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{u.profile.bio}</p>}
              {u.profile.job_description && <p className="mt-3 line-clamp-3 text-xs text-slate-500 dark:text-slate-400">{u.profile.job_description}</p>}
              <div className="mt-auto space-y-1 pt-4 text-sm">
                {(u.profile.official_email || u.email) && <a className="flex items-center gap-2 truncate text-brand-700 hover:underline dark:text-brand-200" href={`mailto:${u.profile.official_email || u.email}`}><Mail className="size-4 shrink-0" />{u.profile.official_email || u.email}</a>}
                {u.profile.phone && <a className="flex items-center gap-2 text-brand-700 hover:underline dark:text-brand-200" href={`tel:${u.profile.phone.replace(/\s/g, "")}`}><Phone className="size-4 shrink-0" />{u.profile.phone}</a>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
