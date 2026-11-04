/**
 * The example chart of accounts the journal entries post to. These codes are an EXAMPLE, not the holder's chart: the
 * page labels them "Example chart: map to yours" and the CSV is a file to import, never posted anywhere.
 */
export const CHART_LABEL = "Example chart: map to yours";

export type PropertyType = "vendor_check" | "payroll_check" | "customer_credit" | "unapplied_cash";

export interface Account {
  code: string;
  name: string;
}

export const CASH: Account = { code: "1000", name: "Cash" };
export const AR_CREDIT_BALANCES: Account = { code: "1210", name: "AR credit balances" };
export const UNAPPLIED_CASH: Account = { code: "2150", name: "Unapplied cash" };

/** Unclaimed property payable, one sub-account per owner state ("2400-TX"). */
export function upPayable(state: string): Account {
  return { code: `2400-${state}`, name: `Unclaimed property payable (${state})` };
}

/**
 * The account debited when an item is recognized: a void stale check puts the money back in Cash; a customer credit
 * or unapplied cash leaves the AR credit balance / unapplied cash account. The credit is always UP payable (state).
 */
export function recognitionDebit(type: PropertyType): Account {
  switch (type) {
    case "customer_credit":
      return AR_CREDIT_BALANCES;
    case "unapplied_cash":
      return UNAPPLIED_CASH;
    case "vendor_check":
    case "payroll_check":
      return CASH;
  }
}

/** "1000 Cash", the CSV Account column. */
export const accountLabel = (a: Account): string => `${a.code} ${a.name}`;
