import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Mono ISO-derived date. Missing dates render an explicit Unknown, never blank. */
export function DateCell({ date, className, unknown = "Unknown" }: { date: string | null | undefined; className?: string; unknown?: string }) {
  if (!date) return <span className={cn("text-muted-foreground italic", className)}>{unknown}</span>;
  return (
    <time dateTime={date} className={cn("font-mono text-[13px] tabular-nums", className)}>
      {formatDate(date)}
    </time>
  );
}
