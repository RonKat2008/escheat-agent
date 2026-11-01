import { relativeDays } from "@/lib/format";

export const SOON_DAYS = 7;

/**
 * Relative time for a deadline. Pink is for obligations that close soon. A due-diligence window *opening* is not an
 * obligation closing, so it gets a plain "Opens ..." label instead of "Due today".
 */
export function DueChip({ days, kind }: { days: number; kind?: string }) {
  if (kind === "dd_window_start") {
    return <span className="text-[13px] whitespace-nowrap text-fg-2">{days <= 0 ? "Opens today" : `Opens ${relativeDays(days)}`}</span>;
  }
  if (days <= SOON_DAYS) {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-xs font-medium whitespace-nowrap text-black">
        {days <= 0 ? "Due today" : `Due ${relativeDays(days)}`}
      </span>
    );
  }
  return <span className="text-[13px] whitespace-nowrap text-fg-3">{relativeDays(days)}</span>;
}
