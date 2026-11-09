"use client";

import { CircleCheck, Compass } from "lucide-react";
import type { GettingStartedUi } from "@/lib/chat/ui-types";
import { CARD_PROMPT } from "@/lib/ask/cards/registry";
import { cn } from "@/lib/utils";
import { AskButton } from "../parts";
import { ActionCardFrame, CoralLink, GhostLink } from "./frame";

/**
 * "Getting started" (docs/ASK-MODE.md, Ask cards): the onboarding checklist from real state. A step that is not done
 * is coral (a person does it) and links to where; a done step is a steel check. Steps that have an Ask card also offer
 * "Do it here", which sends that card's prompt.
 */
export function GettingStartedView({ steps, doneCount, total }: GettingStartedUi["props"]) {
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  return (
    <ActionCardFrame
      testId="view-getting-started"
      icon={<Compass />}
      eyebrow="Getting started"
      title={doneCount === total ? "Setup is complete" : `${doneCount} of ${total} steps done`}
      meta={`${pct}%`}
      footer={
        <>
          <AskButton question={CARD_PROMPT.integrations}>Set up integrations</AskButton>
          <AskButton question={CARD_PROMPT.needs_you}>What needs me?</AskButton>
          <GhostLink href="/dashboard">Dashboard</GhostLink>
        </>
      }
    >
      <div className="px-4 pt-3 sm:px-5" aria-hidden>
        <div className="h-1 overflow-hidden rounded-full bg-fg-1/10">
          <div className="h-full origin-left rounded-full bg-blue-400" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      </div>
      <ol className="divide-y divide-line" aria-label="Setup steps">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-5" data-testid="getting-started-step" data-step={s.id} data-done={s.done}>
            <span
              className={cn(
                "num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px]",
                s.done ? "bg-blue-400/15 text-blue-400" : "bg-pink-500/15 text-pink-400 ring-1 ring-pink-500/50",
              )}
              aria-hidden
            >
              {s.done ? <CircleCheck className="size-3.5" strokeWidth={2} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-[13px] font-medium text-fg-1">
                {s.title}
                <span className="sr-only">{s.done ? " (done)" : " (needs a person)"}</span>
              </p>
              <p className="text-xs text-pretty text-fg-2">{s.detail}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!s.done && s.askPrompt ? <AskButton question={s.askPrompt}>Do it here</AskButton> : null}
              {s.done ? <GhostLink href={s.href}>{s.linkLabel}</GhostLink> : <CoralLink href={s.href} testId="getting-started-action">{s.linkLabel}</CoralLink>}
            </div>
          </li>
        ))}
      </ol>
    </ActionCardFrame>
  );
}
