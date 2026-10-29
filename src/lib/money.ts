/** Money is integer cents everywhere. Floats never carry currency. */

export type Cents = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Not an integer cent amount: ${value}`);
  return value;
}

/** Parse "1,234.56", "$1,234.56", "(12.00)" or "-12.5" to cents. Returns null if unparseable. */
export function parseDollars(input: string): Cents | null {
  let s = input.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return neg ? -cents : cents;
}

/** cents -> dollars as a number (display math only, never stored). */
export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/** "$2,340.00" / "-$12.00". Always two decimals so columns align (pair with `tabular-nums`). */
export function formatUSD(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars}.${frac}`;
}

/** Like formatUSD but without the symbol, for tables with a currency column header. */
export function formatAmount(cents: Cents): string {
  return formatUSD(cents).replace("$", "");
}

/** Simple-interest helper in integer cents, rounded half away from zero. */
export function mulRateCents(cents: Cents, ratePerYear: number, years: number): Cents {
  const v = cents * ratePerYear * years;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}
