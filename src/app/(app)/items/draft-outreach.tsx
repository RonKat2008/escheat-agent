"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "@/lib/toast";
import { postJson } from "@/components/b/api";
import { Button } from "@/components/ui/button";
import { useDraftState } from "./draft-state";

interface DraftResponse {
  outreachId: string;
  channel: string;
  readiness?: { ready?: boolean };
}

/**
 * POSTs a letter draft; the letter then waits in /approvals. Nothing is sent from here. A refused draft (HTTP 409,
 * code "draft_refused", for example a closed due-diligence window) is shown plainly next to the button.
 */
export function DraftOutreach({ staleItemId }: { staleItemId: string }) {
  const router = useRouter();
  const { drafted, setDrafted } = useDraftState();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setRefusal(null);
    const res = await postJson<DraftResponse>("/api/outreach/draft", { staleItemId, channel: "letter" });
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409 || res.code === "draft_refused") {
        setRefusal(res.error);
        return;
      }
      toast.error("Could not draft the letter", { description: res.error });
      return;
    }
    setDrafted({ outreachId: res.data.outreachId, channel: res.data.channel ?? "letter", ready: res.data.readiness?.ready !== false });
    toast.success("Letter drafted", { description: "It is waiting for your approval.", action: { label: "Open approvals", onClick: () => router.push("/approvals") } });
    // F29: pull the stored outreach row into the drawer (the list already shows the new draft meanwhile).
    router.refresh();
  }

  if (drafted) {
    return (
      <Link href="/approvals" className="inline-flex h-8 items-center text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
        Review in approvals
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" onClick={() => void draft()} disabled={busy} data-testid="drawer-draft">
        <Mail className="size-3.5" aria-hidden />
        {busy ? "Drafting…" : "Draft outreach"}
      </Button>
      {refusal ? (
        <span role="alert" data-testid="draft-refused" className="max-w-[260px] text-right text-xs text-pink-400">
          Not drafted: {refusal}
        </span>
      ) : null}
    </span>
  );
}
