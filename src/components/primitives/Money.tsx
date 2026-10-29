import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Integer cents in. Tabular mono so columns align. */
export function Money({
  cents,
  className,
  muted,
  bare,
}: {
  cents: number;
  className?: string;
  muted?: boolean;
  /** Drop the $ sign (use under a column titled in dollars). */
  bare?: boolean;
}) {
  const text = formatUSD(cents);
  return (
    <span className={cn("font-mono tabular-nums", muted && "text-muted-foreground", className)}>{bare ? text.replace("$", "") : text}</span>
  );
}
