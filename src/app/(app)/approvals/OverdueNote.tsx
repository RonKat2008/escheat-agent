import { TriangleAlert } from "lucide-react";
import { UnverifiedBadge } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { lateLabel } from "@/lib/overdue";
import { cn } from "@/lib/utils";
import type { QueueEntry } from "./queue-data";

/** "Window closed May 2, 2027 (missed, 183 days late)". Pink: the deadline this approval serves has passed. */
export function OverdueNote({ overdue, compact, className }: { overdue: QueueEntry["overdue"]; compact?: boolean; className?: string }) {
  if (!overdue) return null;
  return (
    <span data-testid="approval-overdue" className={cn("inline-flex items-center gap-1.5 text-pink-300", compact ? "text-xs" : "text-[13px] font-medium", className)}>
      {compact ? null : <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />}
      <span>
        {overdue.label} {formatDate(overdue.date)} (missed{compact ? "" : `, ${lateLabel(overdue.daysLate)}`})
      </span>
      {!overdue.verified ? <UnverifiedBadge compact /> : null}
    </span>
  );
}
