"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** POSTs a letter draft; the letter then waits in /approvals. Nothing is sent from here. */
export function DraftOutreach({ staleItemId }: { staleItemId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function draft() {
    setBusy(true);
    try {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staleItemId, channel: "letter" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Draft failed (${res.status})`);
      setDone(true);
      toast.success("Letter drafted", { description: "It is waiting for your approval.", action: { label: "Open approvals", onClick: () => window.location.assign("/approvals") } });
    } catch (e) {
      toast.error("Could not draft the letter", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Link href="/approvals" className="text-sm text-at-risk underline-offset-2 hover:underline">
        Review in approvals
      </Link>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={draft} disabled={busy}>
      <Mail className="size-3.5" aria-hidden />
      {busy ? "Drafting…" : "Draft outreach"}
    </Button>
  );
}
