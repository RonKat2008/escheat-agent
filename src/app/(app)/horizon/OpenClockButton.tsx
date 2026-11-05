"use client";

import { CalendarClock } from "lucide-react";

/** Opens the demo clock control in the top bar (the shell owns it; this only clicks and focuses its trigger). */
export function OpenClockButton() {
  return (
    <button
      type="button"
      data-testid="check-open-clock"
      onClick={() => {
        const trigger = document.querySelector<HTMLButtonElement>('button[aria-label^="Demo clock"]');
        trigger?.focus();
        trigger?.click();
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-blue-700 px-2.5 py-1 text-[13px] text-blue-300 transition-colors duration-150 hover:border-blue-500 hover:text-blue-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    >
      <CalendarClock className="size-3.5" aria-hidden />
      Open the demo clock
    </button>
  );
}
