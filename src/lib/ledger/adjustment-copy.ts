/** R11-01: the one-line label of a prior-period adjustment, shared by the Ledger and the Ask close card. Pure. */
import { monthLabel } from "@/lib/close-pack/period";
import { formatUSD } from "@/lib/money";
import type { PriorPeriodAdjustment } from "./rollforward";

const MINUS = "−";

/** "Prior-period adjustment: 2 rows dated in closed months (Apr 2022, Apr 2024), +$1,348.35." */
export function priorPeriodLine(a: Pick<PriorPeriodAdjustment, "count" | "cents" | "months">): string {
  const rows = `${a.count} ${a.count === 1 ? "row" : "rows"}`;
  const where = a.months.length === 1 ? `in ${monthLabel(a.months[0]!)}` : `in closed months (${a.months.map(monthLabel).join(", ")})`;
  const amount = `${a.cents < 0 ? MINUS : "+"}${formatUSD(Math.abs(a.cents))}`;
  return `Prior-period adjustment: ${rows} dated ${where}, ${amount}.`;
}
