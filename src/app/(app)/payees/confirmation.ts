import { plural } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import type { ChangePreview, PayeeChange } from "@/lib/payees/review-types";

/** What the page shows for a moment after a payee change is saved. Every fact comes from the applied preview. */
export interface ChangeConfirmation {
  applied: boolean;
  title: string;
  facts: string[];
  /** Payee row to highlight briefly (the survivor of a merge, the new payee of a split, the renamed payee). */
  focusId: string | null;
}

function titleFor(change: PayeeChange, preview: ChangePreview): string {
  if (change.kind === "merge") return `Merged “${preview.mergeName ?? "payee"}” into “${preview.keepName ?? preview.resultingCanonical}”`;
  if (change.kind === "split") return `Split “${change.alias}” into its own payee`;
  return `Renamed to “${preview.resultingCanonical}”`;
}

export function confirmationFor(change: PayeeChange, preview: ChangePreview, applied: boolean, newPayeeId: string | null): ChangeConfirmation {
  if (!applied) return { applied: false, title: "Nothing changed.", facts: ["The payees already matched what you confirmed."], focusId: null };
  const facts: string[] = [];
  const moved = preview.diffs.length;
  facts.push(moved === 0 ? "No items moved" : `${plural(moved, "item")} moved`);
  if (preview.ownerStateChanges > 0) facts.push(`${plural(preview.ownerStateChanges, "owner state")} changed`);
  else if (moved > 0) facts.push("owner states unchanged");
  if (preview.amountMovingCents > 0) facts.push(`${formatUSD(preview.amountMovingCents)} across them`);
  if (preview.ledgerLinesMoved > 0) facts.push(`${plural(preview.ledgerLinesMoved, "ledger line")} relinked`);
  facts.push("recorded as a human decision");
  const focusId = change.kind === "merge" ? change.keepId : change.kind === "split" ? newPayeeId : change.payeeId;
  return { applied: true, title: titleFor(change, preview), facts, focusId };
}
