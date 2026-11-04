/**
 * Short money labels for diagrams (R5-19). Rounded to the nearest unit, never truncated: $773.74 reads "$774" and
 * $23,351.80 reads "$23.4k", so a label never disagrees with the exact figure it stands for by more than rounding.
 * The exact cents always stay in the accessible name and the tooltip.
 */
const WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Nearest whole dollar, halves away from zero: 157410 → "$1,574", 77374 → "$774". */
export function roundedWholeUSD(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return WHOLE.format(cents < 0 && dollars > 0 ? -dollars : dollars);
}

/** Labels compact from $10,000 up. */
export const COMPACT_FROM_CENTS = 1_000_000;

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** "$774", "$9,999", then "$23.4k" and "$1.25M": one decimal of thousands, two of millions, trailing zeros dropped. */
export function compactUSD(cents: number): string {
  const abs = Math.abs(cents);
  if (abs < COMPACT_FROM_CENTS) return roundedWholeUSD(cents);
  const sign = cents < 0 ? "-" : "";
  const dollars = abs / 100;
  if (dollars >= 999_950) return `${sign}$${trimZeros((Math.round(dollars / 10_000) / 100).toFixed(2))}M`;
  return `${sign}$${trimZeros((Math.round(dollars / 100) / 10).toFixed(1))}k`;
}
