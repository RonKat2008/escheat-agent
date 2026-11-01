import type { Format } from "@number-flow/react";

/** Whole dollars, truncated the way <Money wholeDollars/> truncates, so animated and static figures agree. */
export const wholeDollars = (cents: number): number => Math.trunc(cents / 100);

/** Intl options for a whole-dollar figure ("$25,526"). */
export const USD_WHOLE: Format = { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 };

/** Plain integer count. */
export const INTEGER: Format = { maximumFractionDigits: 0 };

/** The text a whole-dollar figure reads as, matching USD_WHOLE. */
export const formatWholeUSD = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(wholeDollars(cents));
