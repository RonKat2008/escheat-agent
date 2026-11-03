"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { Money } from "@/components/primitives";
import { formatUSD } from "@/lib/money";
import { markResolvedPaidAction } from "../items/actions";
import { notify } from "./notify";
import { Fact, Frame } from "./OtherDetails";
import { OwnerReplyPanel } from "./OwnerReplyPanel";
import type { QueueEntry } from "./queue-data";

const STEPS: Record<string, string> = {
  verify_and_reissue: "Verify the owner's identity and the payment details, reissue the payment, then mark the item resolved.",
  verify_cleared: "Find the cleared payment in your bank records, then mark the item resolved.",
  update_address: "Their address on file was updated. Re-mail the payment to it, then mark the item resolved.",
};

/**
 * The owner loop on screen (biggest opportunity #4): an owner answered a sent notice, so the holder owes a follow-up.
 * "Mark resolved" is the authenticated, approval-recorded path to resolved_paid (the owner's link never closes anything);
 * once recorded the item leaves the queue and the exposure total.
 */
export function OwnerTaskDetail({ entry }: { entry: QueueEntry }) {
  const t = entry.ownerTask!;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function resolve() {
    setError(null);
    startTransition(async () => {
      const res = await markResolvedPaidAction({ staleItemId: t.staleItemId, expectedStatus: "owner_responded", by: approver });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      notify.success("Marked resolved (paid)", { description: `${formatUSD(t.amountCents)} leaves the exposure total.` });
      router.refresh();
    });
  }

  return (
    <Frame
      entry={entry}
      footer={
        done ? (
          <p className="flex items-center gap-2 text-[13px] text-fg-1" role="status" data-testid="owner-task-resolved">
            <CheckCircle2 className="size-4 text-blue-400" strokeWidth={1.75} aria-hidden />
            Resolved. {formatUSD(t.amountCents)} is out of the exposure total.
          </p>
        ) : (
          <>
            <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-fg-3">
              Only after you verified the payment. Recorded as an approval under your session; the owner&apos;s reply alone never closes an item.
            </p>
            <ActionButton id="approve-btn" variant="approve" pending={pending} disabled={approver.trim().length < 2} onClick={resolve} data-testid="owner-task-resolve">
              Mark resolved (paid)
            </ActionButton>
            {error ? (
              <p role="alert" className="w-full text-xs text-pink-300">
                {error}
              </p>
            ) : null}
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-3">
        <Fact label="Owner">{t.ownerName}</Fact>
        <Fact label="Amount">
          <Money cents={t.amountCents} />
        </Fact>
        <Fact label="Item">
          {t.propertyLabel}
          {t.referenceNumber ? ` #${t.referenceNumber}` : ""}
        </Fact>
      </dl>
      <section aria-labelledby="owner-task-next">
        <h3 id="owner-task-next" className="mb-1.5 text-[13px] font-medium text-fg-1">
          What you do next
        </h3>
        <p className="max-w-[68ch] text-[13px] leading-6 text-fg-2" data-testid="owner-task-steps">
          {STEPS[t.holderTask ?? ""] ?? "Follow up with the owner, then mark the item resolved once the payment is verified."}
        </p>
      </section>
      {t.reply ? <OwnerReplyPanel reply={t.reply} staleItemId={t.staleItemId} /> : null}
      <Link href={`/items?item=${t.staleItemId}`} className="inline-flex items-center gap-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
        Open the item <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Link>
    </Frame>
  );
}
