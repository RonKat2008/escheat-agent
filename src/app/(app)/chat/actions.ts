"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { AuthError, requireSession } from "@/lib/auth/session";
import { explainItem, findStaleItemId, getDefaultCompanyId, type Explanation } from "@/lib/queries";

export type ItemTimelineResult = { ok: true; explanation: Explanation } | { ok: false; error: string };

const ItemId = z.string().uuid();

/**
 * Read-only: the legal timeline for one item, for the chat's inline row expansion. Same session gate and company
 * scope as the items page; it never calls the model and never writes.
 */
export async function loadItemTimeline(itemId: string): Promise<ItemTimelineResult> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = ItemId.safeParse(itemId);
  if (!parsed.success) return { ok: false, error: "Unknown item." };
  try {
    const db = await getDb();
    const companyId = await getDefaultCompanyId(db);
    const id = await findStaleItemId(db, companyId, parsed.data);
    const explanation = id ? await explainItem(db, id) : null;
    return explanation ? { ok: true, explanation } : { ok: false, error: "This item no longer exists." };
  } catch (e) {
    console.error("[chat] item timeline failed", e);
    return { ok: false, error: "Could not load the timeline. Open it in Items instead." };
  }
}
