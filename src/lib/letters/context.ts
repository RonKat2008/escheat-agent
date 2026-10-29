import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  companies,
  ledgerItems,
  payees,
  staleItems,
  type Company,
  type LedgerItem,
  type Payee,
  type StaleItem,
} from "@/db/schema";
import { OutreachNotFoundError } from "@/lib/outreach/errors";

export interface OwnerAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

export interface ItemContext {
  stale: StaleItem;
  ledger: LedgerItem;
  company: Company;
  payee: Payee | null;
  ownerName: string;
  /** Null when no usable mailing address is on file. */
  ownerAddress: OwnerAddress | null;
}

function toAddress(a: { line1?: string | null; city?: string | null; state?: string | null; zip?: string | null }): OwnerAddress | null {
  const line1 = a.line1?.trim();
  const city = a.city?.trim();
  const state = a.state?.trim();
  const zip = a.zip?.trim();
  if (!line1 || !city || !state || !zip) return null;
  return { line1, city, state: state.toUpperCase(), zip };
}

export async function loadItemContext(db: Db, staleItemId: string): Promise<ItemContext> {
  const [stale] = await db.select().from(staleItems).where(eq(staleItems.id, staleItemId));
  if (!stale) throw new OutreachNotFoundError("Stale item", staleItemId);
  const [ledger] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, stale.ledgerItemId));
  const [company] = await db.select().from(companies).where(eq(companies.id, stale.companyId));
  if (!ledger || !company) throw new OutreachNotFoundError("Ledger item or company for stale item", staleItemId);
  const payeeId = stale.ownerPayeeId ?? ledger.payeeId;
  const [payee] = payeeId ? await db.select().from(payees).where(eq(payees.id, payeeId)) : [];
  const fromPayee = payee ? toAddress({ line1: payee.addressLine, city: payee.city, state: payee.state, zip: payee.zip }) : null;
  const fromLedger = toAddress({ line1: ledger.addressLine, city: ledger.city, state: ledger.state, zip: ledger.zip });
  return {
    stale,
    ledger,
    company,
    payee: payee ?? null,
    ownerName: payee?.canonicalName ?? ledger.payeeNameRaw,
    ownerAddress: fromPayee ?? fromLedger,
  };
}

export const PROPERTY_LABEL: Record<string, string> = {
  vendor_check: "vendor check",
  payroll_check: "payroll check",
  customer_credit: "customer credit",
  unapplied_cash: "unapplied cash",
};

export function kindOf(propertyType: string): "check" | "credit" | "unapplied_cash" {
  if (propertyType === "customer_credit") return "credit";
  if (propertyType === "unapplied_cash") return "unapplied_cash";
  return "check";
}
