"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { AskStarter } from "@/lib/ask/starters";
import { cn } from "@/lib/utils";
import { AskOrnament } from "./AskOrnament";

/** Autofocus the hero composer only on wide screens with a fine pointer (never pops the keyboard on touch). */
const AUTOFOCUS_QUERY = "(min-width: 1024px) and (pointer: fine)";

/**
 * The prompt a click on a state in the "Where the money is" preview sends (docs/ASK-MODE.md §4). Online it lists that
 * state's open items; offline it asks the exposure question for that state, which offline chat answers from the data.
 */
export function mapPickPrompt(state: string, offline: boolean): string {
  return offline ? `What do we owe in ${state}?` : `Show the open ${state} items`;
}

const CHIP_TONE: Record<AskStarter["tone"], { chip: string; dot: string; hint: string }> = {
  human: {
    chip: "border-pink-500/55 hover:border-pink-400 hover:bg-pink-500/[0.12]",
    dot: "bg-pink-500 shadow-[0_0_8px_rgb(255_107_91/0.8)]",
    hint: "text-pink-300",
  },
  info: {
    chip: "hover:border-blue-400/60 hover:bg-fg-1/[0.08]",
    dot: "bg-blue-400",
    hint: "text-fg-3",
  },
};

interface AskHeroProps {
  starters: readonly AskStarter[];
  onPick: (prompt: string) => void;
  disabled: boolean;
  offline: boolean;
  /** The availability banner (offline / not configured), shown above the composer. */
  notice: ReactNode;
  /** The hero-size composer. */
  composer: ReactNode;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Server-rendered "Where the money is" preview (compact Money Map), or null when there is no data. */
  mapPreview?: ReactNode;
}

function StarterChips({ starters, onPick, disabled }: Pick<AskHeroProps, "starters" | "onPick" | "disabled">) {
  return (
    <ul className="mt-5 flex flex-wrap gap-2" aria-label="Suggested starts" data-testid="ask-starters">
      {starters.map((s) => {
        const tone = CHIP_TONE[s.tone];
        return (
          <li key={s.prompt} className="max-w-full">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s.prompt)}
              data-testid="chat-example"
              data-tone={s.tone}
              className={cn(
                "glass-pill chat-focus press inline-flex min-h-10 max-w-full items-center gap-2 px-3.5 py-1.5 text-left text-[14px] text-fg-1 transition-[background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[13px]",
                tone.chip,
              )}
            >
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
              <span className="min-w-0">{s.prompt}</span>
              {s.hint ? <span className={cn("shrink-0 text-xs", tone.hint)}>· {s.hint}</span> : null}
              {s.tone === "human" ? <span className="sr-only"> (needs a person)</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Ask's empty state (docs/ASK-MODE.md §1.1): a huge light cream headline, one sentence, the large glass composer,
 * starter chips built from real state (coral = a person must act, steel = read-only), and the "Where the money is"
 * preview on the right at ≥1024px (under the chips below that). Keeps the `chat-empty` / `chat-example` testids.
 */
export function AskHero({ starters, onPick, disabled, offline, notice, composer, inputRef, mapPreview }: AskHeroProps) {
  useEffect(() => {
    if (disabled || !window.matchMedia(AUTOFOCUS_QUERY).matches) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [disabled, inputRef]);

  // A click on a state column asks about that state instead of leaving Ask (the link still works without JS or when
  // chat cannot send, and with a modifier key for a new tab).
  const onMapClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const col = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-map-col]");
    const state = col?.dataset.mapCol;
    if (!state) return;
    e.preventDefault();
    onPick(mapPickPrompt(state, offline));
  };

  return (
    <div
      className="relative mx-auto grid w-full max-w-[1120px] flex-1 content-center gap-x-12 gap-y-10 pt-4 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-center lg:pt-8"
      data-testid="chat-empty"
    >
      <AskOrnament />
      <div className="relative z-[1] min-w-0">
        <h1 className="type-display text-[44px] text-balance sm:text-[60px] lg:text-[72px]" data-testid="ask-headline">
          What do you want
          <br /> to get done?
        </h1>
        <p className="mt-4 max-w-[56ch] text-[15px] text-pretty text-fg-2">
          Ask a question, or ask me to do something. Anything that leaves the app waits for your click.
        </p>
        <div className="mt-8">
          {notice}
          {composer}
        </div>
        <StarterChips starters={starters} onPick={onPick} disabled={disabled} />
      </div>
      {mapPreview ? (
        <section aria-labelledby="ask-map-h" className="glass relative z-[1] min-w-0 overflow-x-clip rounded-[24px] p-4 sm:p-5" data-testid="ask-map-preview" onClickCapture={onMapClick}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="ask-map-h" className="type-label">
              Where the money is
            </h2>
            <Link href="/dashboard" className="chat-focus inline-flex items-center gap-1 rounded-full text-xs text-fg-3 transition-colors duration-150 hover:text-fg-1">
              Dashboard
              <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
            </Link>
          </div>
          {mapPreview}
        </section>
      ) : null}
    </div>
  );
}
