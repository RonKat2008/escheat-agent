"use client";

import { CalendarClock, CornerDownLeft, FileSearch, Landmark, ListChecks, ShieldQuestion, type LucideIcon } from "lucide-react";
import { InstrumentLabel } from "@/components/primitives";
import { hasRecordedAnswer } from "@/lib/chat/recorded-prompts";
import { CLOSE_OUT_PROMPTS, EXAMPLE_PROMPTS, STARTER_PROMPTS } from "./followups";

/** What each starter returns, so the chip says which card the answer will be (never a number). */
const STARTER_META: Record<string, { icon: LucideIcon; card: string }> = {
  "What do we owe and where?": { icon: Landmark, card: "Exposure by state" },
  "What's due in the next 90 days?": { icon: CalendarClock, card: "Deadline list" },
  "Explain check #10482": { icon: FileSearch, card: "Item timeline" },
  "Draft the due-diligence letter for #10482": { icon: ShieldQuestion, card: "Letter draft for your approval" },
};

const chip =
  "chat-focus press disabled:cursor-not-allowed disabled:opacity-50 transition-[background-color,border-color,color] duration-150";

/**
 * The empty chat (§6.12 hero): four starter prompts as large chips over the vault grid, the other examples as small
 * chips, and the guided close-out row. Offline, every chip shown has a recorded answer (F36).
 */
export function EmptyChat({ onPick, disabled, offline }: { onPick: (q: string) => void; disabled: boolean; offline: boolean }) {
  const ok = (q: string) => !offline || hasRecordedAnswer([], q);
  const starters = STARTER_PROMPTS.filter(ok);
  const more = EXAMPLE_PROMPTS.filter((q) => !starters.includes(q as (typeof starters)[number]) && ok(q));
  const closeOut = CLOSE_OUT_PROMPTS.filter((p) => ok(p.prompt));

  return (
    <div className="relative mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-end pb-6 sm:justify-center sm:pb-10" data-testid="chat-empty">
      <div aria-hidden className="vault-floor pointer-events-none absolute -inset-x-16 -top-10 bottom-0" />
      <div className="relative">
        <InstrumentLabel as="p">Ask the ledger{offline ? " · offline replay" : ""}</InstrumentLabel>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.015em] text-balance text-fg-1 sm:text-[28px] sm:tracking-[-0.02em]">
          Ask about your unclaimed property
        </h1>
        <p className="mt-2 max-w-[58ch] text-sm text-pretty text-fg-2">
          Answers come from the same records as the rest of the app. Anything that would go out to a person or a state is only drafted here, and waits for
          you in Approvals.
        </p>

        <ul className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Example questions">
          {starters.map((q) => {
            const meta = STARTER_META[q];
            const Icon = meta?.icon ?? CornerDownLeft;
            return (
              <li key={q}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(q)}
                  data-testid="chat-example"
                  className={`${chip} group flex min-h-[76px] w-full items-start gap-3 rounded-[10px] border border-line bg-ink-2/90 px-3.5 py-3 text-left hover:-translate-y-px hover:border-line-hover hover:bg-ink-3`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-blue-400" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug font-medium text-fg-1 sm:text-sm">{q}</span>
                    {meta ? <span className="mt-1 block text-xs text-fg-3">{meta.card}</span> : null}
                  </span>
                  <CornerDownLeft
                    className="mt-0.5 size-3.5 shrink-0 text-fg-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>

        {more.length ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="More questions">
            {more.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(q)}
                  data-testid="chat-example"
                  className={`${chip} inline-flex min-h-9 items-center rounded-[6px] border border-line-hover px-3 text-[13px] text-fg-2 hover:border-blue-400/50 hover:text-fg-1`}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {closeOut.length ? (
          <div className="mt-7" data-testid="chat-close-out">
            <InstrumentLabel as="p" id="close-out-label">
              Guided close-out
            </InstrumentLabel>
            <p className="mt-1 text-xs text-fg-3">Every step for a state&apos;s cycle, with what is done and what needs you.</p>
            <ul className="mt-2.5 flex flex-wrap gap-2" aria-labelledby="close-out-label">
              {closeOut.map((p) => (
                <li key={p.state}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(p.prompt)}
                    data-testid="chat-close-out-chip"
                    className={`${chip} inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-blue-500/40 bg-blue-900/60 px-3 text-[14px] font-medium text-fg-1 hover:border-blue-400 hover:bg-blue-900 sm:text-[13px]`}
                  >
                    <ListChecks className="size-4 text-blue-400" strokeWidth={1.75} aria-hidden />
                    {p.label}
                    <span className="sr-only">: {p.prompt}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
