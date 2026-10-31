"use client";

import { useState } from "react";
import { ChevronDown, ScrollText } from "lucide-react";
import type { RuleStateSummary, RulesUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { FooterLink, UnknownFlag, UnverifiedFlag, VerifiedFlag, ViewCard } from "./parts";

function StateRow({ s }: { s: RuleStateSummary }) {
  const [open, setOpen] = useState(false);
  const unverified = s.total - s.verified;
  const pct = s.total ? (s.verified / s.total) * 100 : 0;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] focus-visible:bg-[var(--chat-ink-3)]"
      >
        <span className="text-[13px] font-semibold text-[var(--chat-t1)]">{s.state}</span>
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-2 text-xs text-[var(--chat-t3)]">
            <span className="font-mono text-[var(--chat-t3)]">v{s.version}</span>
            <span className="tabular-nums">
              {s.verified} of {s.total} verified
            </span>
          </span>
          <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--chat-ink-3)]" aria-hidden>
            <span className="rounded-full bg-[var(--chat-blue-500)]" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {unverified === 0 ? <VerifiedFlag /> : <UnverifiedFlag compact />}
          {s.unknown ? <span className="text-xs text-[var(--chat-t3)] italic tabular-nums">{s.unknown} unknown</span> : null}
        </span>
        <ChevronDown className={cn("size-4 text-[var(--chat-t3)] transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul className="space-y-1 px-4 pb-3 pl-[4.25rem]">
          {s.unverifiedPaths.map((p) => (
            <li key={p.path} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-mono break-all text-[var(--chat-t2)]">{p.path}</span>
              {p.hasValue ? null : <UnknownFlag />}
              {p.todo && !p.hasValue ? <span className="text-[var(--chat-t3)]">{p.todo}</span> : null}
            </li>
          ))}
          {s.unverifiedPaths.length === 0 ? <li className="text-xs text-[var(--chat-t3)]">Every value is verified.</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

export function RulesView({ states }: RulesUi["props"]) {
  const unverified = states.reduce((n, s) => n + s.total - s.verified, 0);
  return (
    <ViewCard
      testId="view-rules"
      icon={<ScrollText />}
      title="Rule verification by state"
      meta={unverified ? `${unverified} values unverified` : "all verified"}
      footer={
        <>
          <span className="text-xs text-pretty text-[var(--chat-t3)]">Only a person can verify a rule value, against its official source.</span>
          <span className="flex-1" />
          <FooterLink href="/rules">Verify in Rules</FooterLink>
        </>
      }
    >
      <ul className="divide-y divide-[var(--chat-line)]">
        {states.map((s) => (
          <StateRow key={s.state} s={s} />
        ))}
      </ul>
    </ViewCard>
  );
}
