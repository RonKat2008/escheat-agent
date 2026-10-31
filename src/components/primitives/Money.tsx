import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Integer cents in. Proportional face with tabular figures; cents recede so dollars carry the weight. */
export function Money({
  cents,
  className,
  muted,
  bare,
  dimCents = true,
  wholeDollars,
}: {
  cents: number;
  className?: string;
  muted?: boolean;
  /** Drop the $ sign (use under a column titled in dollars). */
  bare?: boolean;
  dimCents?: boolean;
  /** Round display to whole dollars (summary figures only). */
  wholeDollars?: boolean;
}) {
  const full = formatUSD(cents);
  const text = bare ? full.replace("$", "") : full;
  const dot = text.lastIndexOf(".");
  const whole = dot >= 0 ? text.slice(0, dot) : text;
  const frac = dot >= 0 ? text.slice(dot) : "";
  return (
    <span className={cn("num whitespace-nowrap", muted && "text-fg-3", className)}>
      {whole}
      {wholeDollars || !frac ? null : dimCents ? <span className="money-cents">{frac}</span> : frac}
    </span>
  );
}
