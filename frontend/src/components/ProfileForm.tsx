import { Camera, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api/client";
import type { User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Brand";
import { Alert, Button, Field, Input, Textarea } from "./ui";

const MAX_BYTES = 3 * 1024 * 1024;

export default function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved?: (u: User) => void }) {
  const { user, setUser } = useAuth();
  const p = user!.profile;
  const [form, setForm] = useState({ name: user!.name, position: p.position, job_description: p.job_description,
    official_email: p.official_email || user!.email, phone: p.phone, bio: p.bio });
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };

  const pick = (f?: File) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setError("Choose a JPG, PNG or WebP photo."); return; }
    if (f.size > MAX_BYTES) { setError("The photo must be 3 MB or smaller."); return; }
    setError(""); setPhoto(f); setRemovePhoto(false); setPreview(URL.createObjectURL(f)); setSaved(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    try {
      if (form.name.trim() !== user!.name) await api.patch("/me/", { name: form.name.trim() });
      const body = new FormData();
      (["position", "job_description", "official_email", "phone", "bio"] as const).forEach((k) => body.append(k, form[k].trim()));
      if (photo) body.append("photo", photo);
      if (removePhoto) body.append("remove_photo", "true");
      await api.patch("/me/profile/", body);
      const { data } = await api.get<User>("/me/");
      setUser(data); setPhoto(null); setRemovePhoto(false); setSaved(true);
      onSaved?.(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = removePhoto ? null : preview || p.photo_url;
  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar name={form.name || user!.email} src={shown} size="xl" />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose a profile photo" />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><Camera className="size-4" /> {shown ? "Change photo" : "Add photo"}</Button>
          {shown && <Button type="button" variant="ghost" onClick={() => { setPhoto(null); setPreview(null); setRemovePhoto(!!p.photo_url); }} aria-label="Remove photo"><Trash2 className="size-4" /></Button>}
        </div>
        <p className="text-xs text-slate-500">JPG, PNG or WebP, up to 3 MB. Optional.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={form.name} onChange={set("name")} required maxLength={150} autoComplete="name" /></Field>
        <Field label="Position *"><Input value={form.position} onChange={set("position")} required maxLength={120} placeholder="e.g. International Sales Executive" /></Field>
        <Field label="Official email *"><Input type="email" value={form.official_email} onChange={set("official_email")} required autoComplete="email" /></Field>
        <Field label="Official phone *" hint="With country code, e.g. +880 1712 345678">
          <Input type="tel" value={form.phone} onChange={set("phone")} required pattern="^\+?[0-9 ()\-]{6,20}$" autoComplete="tel" />
        </Field>
        <Field label="Job description *" className="sm:col-span-2" hint="What you're responsible for — markets, products, accounts.">
          <Textarea value={form.job_description} onChange={set("job_description")} required maxLength={2000} />
        </Field>
        <Field label="Short bio" className="sm:col-span-2" hint="Optional. Shown on your profile card.">
          <Textarea value={form.bio} onChange={set("bio")} maxLength={1000} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" busy={busy}>{submitLabel}</Button>
          {saved && <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400" role="status">Saved</span>}
        </div>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      </div>
    </form>
  );
}
