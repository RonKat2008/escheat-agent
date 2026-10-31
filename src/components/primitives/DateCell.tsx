import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Dates are prose, not code: proportional with tabular figures. Missing dates render an explicit Unknown, never blank. */
export function DateCell({ date, className, unknown = "Unknown" }: { date: string | null | undefined; className?: string; unknown?: string }) {
  if (!date) return <span className={cn("text-fg-3 italic", className)}>{unknown}</span>;
  return (
    <time dateTime={date} className={cn("num whitespace-nowrap", className)}>
      {formatDate(date)}
    </time>
  );
}
