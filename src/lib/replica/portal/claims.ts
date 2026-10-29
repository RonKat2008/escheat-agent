import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { replicaClaims, type ReplicaClaim } from "@/db/schema";
import { makeConfirmationNumber } from "./confirmation";
import { stateSchema } from "./portals";
import { findRecord, loadSearchRecords, type SearchRecord } from "./search";

const claimInput = z.object({
  state: stateSchema,
  propertyId: z.string().trim().min(1).max(80),
  claimantName: z.string().trim().min(2, "Enter the claimant business name.").max(150),
  contact: z.string().trim().min(3, "Enter a contact name, email or phone.").max(200),
});
export type CreateClaimInput = z.input<typeof claimInput>;

export class ReplicaClaimError extends Error {
  constructor(public readonly code: "unknown_property") {
    super("That property id does not exist in this portal.");
    this.name = "ReplicaClaimError";
  }
}

/** The amount is taken from the stored record, never from the form. */
export async function createClaim(
  db: Db,
  input: CreateClaimInput,
  records: SearchRecord[] = loadSearchRecords(),
): Promise<ReplicaClaim> {
  const parsed = claimInput.parse(input);
  const record = findRecord(parsed.state, parsed.propertyId, records);
  if (!record) throw new ReplicaClaimError("unknown_property");
  const [row] = await db
    .insert(replicaClaims)
    .values({
      state: parsed.state,
      propertyId: record.propertyId,
      // The schema has one claimant column; contact is appended so it is not lost.
      claimantName: `${parsed.claimantName} (contact: ${parsed.contact})`,
      amountCents: record.amountCents,
      confirmationNumber: makeConfirmationNumber(parsed.state, "claim"),
    })
    .returning();
  return row!;
}

export async function getClaim(db: Db, id: string): Promise<ReplicaClaim | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(replicaClaims).where(eq(replicaClaims.id, id));
  return row ?? null;
}
