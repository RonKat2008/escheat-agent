import { describe, expect, it } from "vitest";
import type { ChangePreview, ItemDiff } from "@/lib/payees/review-types";
import { confirmationFor } from "./confirmation";

const KEEP = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";

const diff = (amountCents: number, ownerStateChanged = false): ItemDiff => ({
  staleItemId: `s-${amountCents}`,
  checkNumber: "1001",
  payeeNameRaw: "BAYLINE ELEC",
  amountCents,
  before: { ownerState: "CA", status: "watching", reportDueDate: null, remitDueDate: null },
  after: { ownerState: ownerStateChanged ? "TX" : "CA", status: "watching", reportDueDate: null, remitDueDate: null },
  closed: false,
  ownerStateChanged,
  changed: ownerStateChanged,
});

const preview = (over: Partial<ChangePreview> = {}): ChangePreview => ({
  kind: "merge",
  noop: false,
  summary: 'Merge "BAYLINE ELEC" into "Bayline Electric".',
  keepName: "Bayline Electric",
  mergeName: "BAYLINE ELEC",
  resultingAliases: ["BAYLINE ELEC"],
  resultingCanonical: "Bayline Electric",
  ledgerLinesMoved: 1,
  diffs: [diff(378671)],
  ownerStateChanges: 0,
  amountMovingCents: 378671,
  fingerprint: "f".repeat(64),
  ...over,
});

describe("confirmationFor", () => {
  it("describes a merge with only facts from the preview and focuses the survivor", () => {
    const c = confirmationFor({ kind: "merge", keepId: KEEP, mergeId: GONE }, preview(), true, null);
    expect(c.title).toBe("Merged “BAYLINE ELEC” into “Bayline Electric”");
    expect(c.facts).toEqual(["1 item moved", "owner states unchanged", "$3,786.71 on that item", "1 ledger line relinked", "recorded as a human decision"]);
    expect(c.focusId).toBe(KEEP);
    expect(c.applied).toBe(true);
  });

  it("calls out owner-state changes and pluralises", () => {
    const p = preview({ diffs: [diff(100, true), diff(200, true)], ownerStateChanges: 2, amountMovingCents: 300, ledgerLinesMoved: 0 });
    const c = confirmationFor({ kind: "merge", keepId: KEEP, mergeId: GONE }, p, true, null);
    expect(c.facts.slice(0, 3)).toEqual(["2 items moved", "2 owner states changed", "$3.00 across them"]);
  });

  it("focuses the new payee of a split and the renamed payee of a rename", () => {
    const empty = preview({ diffs: [], amountMovingCents: 0, ledgerLinesMoved: 0 });
    const split = confirmationFor({ kind: "split", payeeId: KEEP, alias: "BAYLINE ELEC" }, empty, true, GONE);
    expect(split.title).toBe("Split “BAYLINE ELEC” into its own payee");
    expect(split.facts).toEqual(["No items moved", "recorded as a human decision"]);
    expect(split.focusId).toBe(GONE);
    const rename = confirmationFor({ kind: "rename", payeeId: KEEP, canonicalName: "Bayline Electric Co" }, preview({ resultingCanonical: "Bayline Electric Co" }), true, null);
    expect(rename.title).toBe("Renamed to “Bayline Electric Co”");
    expect(rename.focusId).toBe(KEEP);
  });

  it("says nothing changed when the apply was a no-op, with no row to focus", () => {
    const c = confirmationFor({ kind: "merge", keepId: KEEP, mergeId: GONE }, preview(), false, null);
    expect(c).toEqual({ applied: false, title: "Nothing changed.", facts: ["The payees already matched what you confirmed."], focusId: null });
  });
});
