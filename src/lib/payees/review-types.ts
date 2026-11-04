import { z } from "zod";
import { approverNameSchema } from "@/lib/auth/approver";

/**
 * Human payee review: merge two payees, split an alias out, rename the canonical name.
 * Everything here is deterministic; no model is involved in deciding any of it.
 */

const uuid = z.string().uuid("Not a valid payee id");
const name = z.string().trim().min(2, "Name must be at least 2 characters").max(200, "Name is too long");

export const payeeChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("merge"), keepId: uuid, mergeId: uuid })
    .refine((v) => v.keepId !== v.mergeId, { message: "Pick two different payees", path: ["mergeId"] }),
  z.object({ kind: z.literal("split"), payeeId: uuid, alias: name }),
  z.object({ kind: z.literal("rename"), payeeId: uuid, canonicalName: name }),
]);
export type PayeeChange = z.infer<typeof payeeChangeSchema>;

export const previewInputSchema = z.object({ change: payeeChangeSchema });

export const applyInputSchema = z.object({
  change: payeeChangeSchema,
  /** Name of the person confirming; recorded as who changed it. */
  by: approverNameSchema,
  /** Fingerprint of the preview the reviewer saw; apply refuses when the affected items changed since. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type ApplyInput = z.infer<typeof applyInputSchema>;

export type PayeeChangeErrorCode = "not_found" | "invalid" | "name_taken" | "alias_not_found" | "stale_preview";

export class PayeeChangeError extends Error {
  constructor(
    public readonly code: PayeeChangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayeeChangeError";
  }
}

export interface ItemSnapshot {
  ownerState: string | null;
  status: string;
  reportDueDate: string | null;
  remitDueDate: string | null;
}

/** One stale item touched by a change, before and after the deterministic recompute. */
export interface ItemDiff {
  staleItemId: string;
  checkNumber: string | null;
  payeeNameRaw: string;
  amountCents: number;
  before: ItemSnapshot;
  after: ItemSnapshot;
  /** Closed items (paid / remitted) move payee but are never recomputed. */
  closed: boolean;
  ownerStateChanged: boolean;
  changed: boolean;
}

export interface ChangePreview {
  kind: PayeeChange["kind"];
  /** Nothing would change (already merged / already named that). */
  noop: boolean;
  summary: string;
  /** Merge only: the payee that survives and the one folded into it. */
  keepName?: string;
  mergeName?: string;
  /** Alias list the surviving / original payee will have afterwards. */
  resultingAliases: string[];
  resultingCanonical: string;
  ledgerLinesMoved: number;
  diffs: ItemDiff[];
  ownerStateChanges: number;
  amountMovingCents: number;
  fingerprint: string;
}
