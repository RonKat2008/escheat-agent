import { ChevronRight, Plus } from "lucide-react";
import { Fragment } from "react";
import { StatusLabel } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { CHANNEL_SEQUENCE, type SequenceChannel } from "./group";

export const CHANNEL_LABEL = { letter: "Letter", email: "Email", voice: "Call" } as const;
const CHANNEL_NEW = { letter: "Draft letter", email: "Draft email", voice: "Draft call script" } as const;

export interface SequenceStep {
  key: string;
  status: string;
}

/**
 * R3-13: an owner's notice as one sequence, letter → email → call. Each existing step is a button that opens that
 * draft (its accessible name is the bare channel, e.g. "Email"); a missing step offers to draft it.
 */
export function ChannelSequence({
  steps,
  active,
  disabled,
  onOpen,
  onDraft,
}: {
  steps: Partial<Record<SequenceChannel, SequenceStep>>;
  active: SequenceChannel;
  disabled: boolean;
  onOpen: (key: string) => void;
  onDraft: (channel: SequenceChannel) => void;
}) {
  return (
    <div role="group" aria-label="Notice sequence for this owner: letter, then email, then call" className="flex flex-wrap items-center gap-1" data-testid="channel-sequence">
      {CHANNEL_SEQUENCE.map((c, i) => {
        const step = steps[c];
        const isActive = c === active;
        return (
          <Fragment key={c}>
            {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-4" strokeWidth={1.5} /> : null}
            {step ? (
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => !isActive && onOpen(step.key)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-2 rounded-md border px-2.5 text-[13px] transition-colors duration-150 max-sm:min-h-10",
                  isActive ? "border-blue-400 bg-ink-3 text-fg-1" : "border-line text-fg-2 hover:bg-ink-2 hover:text-fg-1",
                )}
              >
                <span aria-hidden className="instrument-label text-fg-3">{i + 1}</span>
                <span>{CHANNEL_LABEL[c]}</span>
                <StatusLabel status={step.status} size="sm" className="text-[11px]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDraft(c)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-1 disabled:opacity-45 max-sm:min-h-10"
              >
                <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
                {CHANNEL_NEW[c]}
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
