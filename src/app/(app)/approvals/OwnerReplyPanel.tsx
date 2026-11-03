import Link from "next/link";
import { ArrowUpRight, MessageSquareQuote } from "lucide-react";
import { InstrumentLabel } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import type { OwnerReply } from "./queue-data";

const CHOICE: Record<string, string> = {
  confirm_address: "Confirmed their mailing address",
  already_cashed: "Says the payment was already cashed",
  send_money: "Asked for the money to be sent",
};

/** The holder's next step for each answer. The owner's word is a claim; nothing is closed until the holder verifies it. */
const NEXT: Record<string, { title: string; body: string; action: string }> = {
  send_money: {
    title: "Next: verify and reissue",
    body: "Confirm the owner's identity and the payment details, then reissue the payment. The item stays open until you record it as paid.",
    action: "Open the item to record the reissue",
  },
  already_cashed: {
    title: "Next: check your bank records",
    body: "Find the cleared check in your bank records. Until it is matched, the item stays open and its deadlines still apply.",
    action: "Open the item",
  },
  confirm_address: {
    title: "Next: recompose with the new address",
    body: "The owner's address on file was updated from their answer. Recompose any unsent letter so it uses it.",
    action: "Open the item",
  },
};

/** R3-10: what the owner answered through their link, their note in their own words, and the holder's next step. */
export function OwnerReplyPanel({ reply, staleItemId }: { reply: OwnerReply; staleItemId: string }) {
  const next = NEXT[reply.intent];
  return (
    <section aria-labelledby="owner-reply" data-testid="owner-reply" className="rounded-[10px] border border-blue-800 bg-blue-950 p-4">
      <InstrumentLabel as="h3" id="owner-reply" className="text-blue-300">
        Owner replied{reply.receivedAt ? ` · ${formatDate(reply.receivedAt.slice(0, 10))}` : ""}
      </InstrumentLabel>
      <p className="mt-1.5 text-[13px] font-medium text-fg-1" data-testid="owner-reply-choice">
        {CHOICE[reply.intent] ?? "Sent a reply"}
      </p>
      {reply.address ? (
        <p className="mt-1 text-[13px] text-fg-2">
          <span className="text-fg-3">New address </span>
          {reply.address}
        </p>
      ) : null}
      {reply.note ? (
        <blockquote className="mt-3 flex gap-2 border-l-2 border-blue-700 pl-3 text-[13px] text-fg-1" data-testid="owner-reply-note">
          <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
          <span className="break-words whitespace-pre-line">{reply.note}</span>
        </blockquote>
      ) : (
        <p className="mt-2 text-xs text-fg-3">No note added.</p>
      )}
      {next ? (
        <div className="mt-4 border-t border-blue-800 pt-3" data-testid="owner-reply-next">
          <p className="text-[13px] font-medium text-fg-1">{next.title}</p>
          <p className="mt-0.5 max-w-[64ch] text-[13px] text-fg-2">{next.body}</p>
          <Link
            href={`/items?item=${staleItemId}`}
            className="mt-2 inline-flex items-center gap-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
          >
            {next.action} <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
