import { FileDown } from "lucide-react";
import { useState } from "react";
import { downloadFile, errorText } from "../api/client";
import { Button } from "./ui";

/** "Download Excel": the Team Operation Sheet layout, filled with the app's numbers. */
export default function DownloadExcel({ year, sheet, label = "Download Excel" }: { year: number; sheet?: number; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true); setError("");
    try {
      await downloadFile(`/team/export/?year=${year}${sheet ? `&sheet=${sheet}` : ""}`, `DSL Team Operation Sheet ${year}.xlsx`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="secondary" onClick={go} busy={busy} title="Excel file laid out like the Team Operation Sheet"><FileDown className="size-4" /> {label}</Button>
      {error && <span className="mt-1 text-xs text-accent-600" role="alert">{error}</span>}
    </span>
  );
}
