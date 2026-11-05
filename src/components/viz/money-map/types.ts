/** Serializable props passed from the server MoneyMap to the client stage. Every figure comes from a query. */

export interface MapStateDatum {
  state: string;
  name: string;
  cents: number;
  /** Whole-dollar display, e.g. "$28,410". */
  short: string;
  /** Full display, e.g. "$28,410.00". */
  formatted: string;
  count: number;
  /** Items whose earliest action deadline is within the next 7 days (not yet missed). */
  urgent: number;
  /** Items past a deadline (the shared overdue assessment). */
  late: number;
  unverified: boolean;
  /** No rules file is loaded for this owner state: the money is owed but the app shows no dates and cannot file it. */
  notCovered?: boolean;
  cx: number;
  cy: number;
  href: string;
  /** Largest open items in this state (for the readout). */
  top: { id: string; payee: string; check: string | null; formatted: string }[];
}

export interface MapHq {
  state: string;
  name: string;
  cx: number;
  cy: number;
}

export interface MapRecovered {
  state: string;
  cx: number;
  cy: number;
  formatted: string;
  count: number;
}
