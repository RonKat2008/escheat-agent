"use client";

import Link from "next/link";
import { BadgeDollarSign, FileCheck2, Inbox, Mail, Phone, ScrollText, Send } from "lucide-react";
import { Money, StatusPill } from "@/components/primitives";
import type { ApprovalsUi, PendingApproval } from "@/lib/chat/ui-types";
import { FooterLink, ViewCard } from "./parts";

const ICON: Record<PendingApproval["kind"], typeof Mail> = {
  letter: Send,
  email: Mail,
  voice: Phone,
  report: FileCheck2,
  claim: BadgeDollarSign,
  rule: ScrollText,
};

export function ApprovalsView({ entries }: ApprovalsUi["props"]) {
  return (
    <ViewCard
      testId="view-approvals"
      icon={<Inbox />}
      title="Waiting on a human"
      meta={`${entries.length} ${entries.length === 1 ? "item" : "items"}`}
      footer={<FooterLink href="/approvals">Open Approvals</FooterLink>}
    >
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]">Nothing is waiting for approval.</p>
      ) : (
        <ul className="divide-y divide-[var(--chat-line)]">
          {entries.slice(0, 12).map((e) => {
            const Icon = ICON[e.kind];
            return (
              <li key={e.key}>
                <Link
                  href={e.href}
                  className="group grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] focus-visible:bg-[var(--chat-ink-3)]"
                >
                  <Icon className="size-4 text-[var(--chat-t3)]" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-[var(--chat-t1)] group-hover:text-[var(--chat-blue-text)]">{e.title}</span>
                    <span className="block truncate text-xs text-[var(--chat-t3)]">{e.subtitle}</span>
                  </span>
                  <span className="text-right">
                    {e.amountCents !== null ? <span className="block text-[13px] text-[var(--chat-t1)] tabular-nums"><Money cents={e.amountCents} /></span> : null}
                    <StatusPill status={e.status} className="mt-0.5 justify-end text-xs" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ViewCard>
  );
}
