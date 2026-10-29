"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { approverLabel, AuthError, requireSession } from "@/lib/auth/session";
import { markResolvedPaid, ResolveError } from "@/lib/stale/resolve";

const Input = z.object({
  staleItemId: z.string().uuid(),
  expectedStatus: z.enum(["watching", "dd_pending", "dd_sent", "owner_responded", "to_report", "reported", "needs_rule"]),
  by: z.string().trim().min(2, "Enter your name (2+ characters)").max(80),
});

export type ResolveActionResult = { ok: true } | { ok: false; error: string };

/** Authenticated, approval-recorded transition to resolved_paid (public owner links can never do this). */
export async function markResolvedPaidAction(raw: z.input<typeof Input>): Promise<ResolveActionResult> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  try {
    await markResolvedPaid(await getDb(), {
      staleItemId: parsed.data.staleItemId,
      expectedStatus: parsed.data.expectedStatus,
      by: approverLabel(session, parsed.data.by),
    });
    for (const p of ["/items", "/dashboard", "/approvals"]) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    if (e instanceof ResolveError) return { ok: false, error: e.message };
    console.error("[items] mark resolved failed", e);
    return { ok: false, error: "Could not record the resolution. See the server log." };
  }
}
