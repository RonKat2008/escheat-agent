import type { PayeeRow } from "@/lib/payees/review-queries";
import { LOW_CONFIDENCE } from "@/lib/payees/review-shared";
import { cn } from "@/lib/utils";

const LABEL: Record<PayeeRow["mergeBasis"], string> = { exact: "Exact", rule: "Rule", model: "Model", human: "Human" };

/** Merge basis + confidence. Model merges and low-confidence non-human merges read as attention (pink). */
export function BasisCell({ row }: { row: Pick<PayeeRow, "mergeBasis" | "mergeConfidence"> }) {
  const shaky = row.mergeBasis === "model" || (row.mergeBasis !== "human" && row.mergeConfidence != null && row.mergeConfidence < LOW_CONFIDENCE);
  return (
    <span className={cn("whitespace-nowrap", shaky ? "font-medium text-pink-300" : "text-fg-2")}>
      {LABEL[row.mergeBasis]}
      {row.mergeConfidence != null ? <span className="num"> {row.mergeConfidence}%</span> : null}
    </span>
  );
}
