"use server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { listStaleItems } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";

export interface PaletteItem {
  id: string;
  checkNumber: string | null;
  payee: string;
  amount: string;
  state: string | null;
}

/** Palette search: payee name or check number. */
export async function searchItemsAction(query: string): Promise<PaletteItem[]> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return [];
    throw e;
  }
  const q = query.trim().replace(/^#/, "");
  if (!q) return [];
  const { db, companyId } = await getCtx();
  const res = await listStaleItems(db, companyId, { search: q, limit: 8, sort: "amount_desc", includeClosed: true });
  return res.items.map((i) => ({ id: i.id, checkNumber: i.checkNumber, payee: i.payeeName, amount: i.amount.formatted, state: i.ownerState }));
}
