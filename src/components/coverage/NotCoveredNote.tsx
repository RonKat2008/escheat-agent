import { NOT_COVERED_COPY, notCoveredLine, type NotCoveredSummary } from "@/lib/coverage";
import { cn } from "@/lib/utils";

/**
 * "Not covered yet: FL, IL, NY, OR · 4 items · $3,497.40" plus the honest copy. Shared by every surface that shows
 * liability in states with no rules file (R9-03), so the count, amount and wording never differ between pages.
 */
export function NotCoveredNote({ summary, testId, extra, className }: { summary: NotCoveredSummary; testId: string; extra?: string; className?: string }) {
  if (summary.count === 0) return null;
  return (
    <div data-testid={testId} className={cn("rounded-[8px] border border-dashed border-line-strong px-3 py-2 text-[13px] text-fg-2", className)}>
      <p className="text-fg-1" data-testid={`${testId}-line`}>
        {notCoveredLine(summary)}
      </p>
      <p className="mt-1">
        {NOT_COVERED_COPY}
        {extra ? ` ${extra}` : ""}
      </p>
    </div>
  );
}
