"use client";

import { useState } from "react";
import { Archive } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export interface MonthOption {
  id: string;
  label: string;
}

/** "Close pack": pick a month with activity, download the month-end ZIP, toast the file count (blue: nobody has to act). */
export function ClosePackButton({ months }: { months: readonly MonthOption[] }) {
  const [month, setMonth] = useState(months[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy || !month) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/close-pack?period=${encodeURIComponent(month)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error("Close pack failed", { description: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const files = res.headers.get("x-close-pack-files");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `escheat-close-pack-${month}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.info(`Close pack downloaded: ${files ?? "6"} files`, { description: "Journal, roll-forward, audit binder, Activity, tie-out and manifest." });
    } catch {
      toast.error("Close pack failed", { description: "The download could not complete." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="close-pack">
      <label className="sr-only" htmlFor="close-pack-month">
        Close pack month
      </label>
      <select
        id="close-pack-month"
        data-testid="close-pack-month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="h-9 rounded-md border border-line-hover bg-ink-2 px-2 text-sm text-fg-1 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
      >
        {months.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy || !month}
        data-testid="close-pack-button"
        className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
      >
        <Archive className="size-4" strokeWidth={1.75} aria-hidden />
        {busy ? "Building…" : "Close pack"}
      </button>
    </div>
  );
}
