import { addDays, daysBetween, nextBusinessDay, prevBusinessDay, subMonths } from "./dates";
import { buildEntities, renderAddress, type Entity, type Role, type StaleGroup } from "./entities";
import {
  DEFAULT_SEED,
  DEMO_ANCHOR_DATE,
  type ClearRow,
  type LedgerRow,
  type SynthPropertyType,
  type SyntheticCompany,
  type SyntheticDataset,
} from "./model";
import { createRng, type Rng } from "./prng";

export const COMPANY: SyntheticCompany = {
  name: "Northwind Fixtures, Inc.",
  incorporation_state: "DE",
  hq_state: "TX",
  address_line: "4100 Sablewood Terrace",
  city: "Austin",
  zip: "78701",
  fiscal_year_end: "12-31",
  fein: null,
  is_synthetic: true,
};

export const FEATURED_NUMBER = "10482";
export const FEATURED_AMOUNT_CENTS = 234_000;
export const TARGET_STALE_COUNT = 47;
export const TARGET_STALE_TOTAL_CENTS = 6_191_500;
const HISTORY_DAYS = 1090;

const KIND_BY_ROLE: Record<Role, SynthPropertyType> = {
  vendor: "vendor_check",
  employee: "payroll_check",
  cust_credit: "customer_credit",
  cust_unapplied: "unapplied_cash",
};

/** [owner-state group, payee role, number of stale items]. Sums: CA 21, TX 15, DE 11. */
const STALE_PLAN: ReadonlyArray<readonly [StaleGroup, Role, number]> = [
  ["CA", "vendor", 16], ["CA", "employee", 2], ["CA", "cust_credit", 2], ["CA", "cust_unapplied", 1],
  ["TX", "vendor", 11], ["TX", "employee", 1], ["TX", "cust_credit", 2], ["TX", "cust_unapplied", 1],
  ["DE", "vendor", 8], ["DE", "employee", 1], ["DE", "cust_credit", 1], ["DE", "cust_unapplied", 1],
];

interface Draft {
  entity: Entity;
  kind: SynthPropertyType;
  name: string;
  fields: ReturnType<typeof renderAddress>;
  amount: number;
  issue: string;
  voided: boolean;
  memo: string;
  clearDate: string | null;
  tie: number;
}

const MEMOS: Record<SynthPropertyType, (r: Rng) => string> = {
  vendor_check: (r) =>
    r.pick([
      () => `Invoice INV-${r.int(1000, 9999)}`,
      () => `PO ${r.int(20000, 79999)} materials`,
      () => `Monthly service - inv ${r.int(1000, 9999)}`,
      () => `Inv ${r.int(1000, 9999)} net 30`,
    ])(),
  payroll_check: (r) =>
    r.pick(["Payroll - net pay", "Bonus payout", `Commission - Q${r.int(1, 4)}`, "Final pay - separation"]),
  customer_credit: (r) =>
    r.pick(["Refund - order cancelled", "Customer credit balance refund", "Overpayment refund", "Returned goods credit"]),
  unapplied_cash: (r) =>
    r.pick(["Unapplied customer payment", "Unapplied cash - deposit on account", "Payment received - no invoice match"]),
};

function amountFor(rng: Rng, kind: SynthPropertyType, entity: Entity): number {
  if (kind === "vendor_check" && entity.fixedAmountsCents.length > 0 && rng.chance(0.5)) {
    return rng.pick(entity.fixedAmountsCents);
  }
  const [lo, hi] = ({
    vendor_check: [85, 9500],
    payroll_check: [400, 2800],
    customer_credit: [40, 1800],
    unapplied_cash: [150, 5200],
  } as const)[kind];
  let cents = Math.round(rng.logUniform(lo, hi) * 100);
  if (kind === "vendor_check" && rng.chance(0.15)) cents = Math.max(5000, Math.round(cents / 5000) * 5000);
  return cents;
}

function pickName(rng: Rng, e: Entity): string {
  return rng.weighted(e.names, e.nameWeights);
}

function draft(rng: Rng, e: Entity, issue: string, amount: number, name?: string): Draft {
  const kind = KIND_BY_ROLE[e.role];
  return {
    entity: e,
    kind,
    name: name ?? pickName(rng, e),
    fields: renderAddress(e.addr, e.style),
    amount,
    issue,
    voided: false,
    memo: MEMOS[kind](rng),
    clearDate: null,
    tie: rng.next(),
  };
}

/** Normal clears land 3-43 days out; ~5% of older items clear 60-200 days late. Never after the anchor. */
function planClear(rng: Rng, issue: string, anchor: string): string | null {
  const age = daysBetween(issue, anchor);
  const late = age >= 260 && rng.chance(0.05);
  const delay = late ? rng.int(60, 200) : rng.int(3, 43);
  const date = nextBusinessDay(addDays(issue, delay));
  return date > anchor ? null : date;
}

/** Per owner-state group totals in cents (featured #10482 is part of CA). Sum = 6,191,500. */
export const STALE_GROUP_TOTAL_CENTS: Record<StaleGroup, number> = {
  CA: 2_841_000,
  TX: 1_986_200,
  DE: 1_364_300,
};

const AMOUNT_RANGE = {
  vendor_check: [150, 4800],
  payroll_check: [300, 2200],
  customer_credit: [60, 1500],
  unapplied_cash: [200, 3500],
} as const;

/** Same-amount pairs (slot indices within the full 47-slot list); never the last slot of a group. */
const AMOUNT_PAIRS: ReadonlyArray<readonly [number, number]> = [[3, 6], [24, 27]];

function staleAmounts(
  rng: Rng,
  kinds: readonly SynthPropertyType[],
  groups: readonly StaleGroup[],
): number[] {
  const out: number[] = new Array(kinds.length).fill(0);
  out[0] = FEATURED_AMOUNT_CENTS;
  for (const group of ["CA", "TX", "DE"] as const) {
    const idxs = groups.map((g, i) => (g === group ? i : -1)).filter((i) => i >= 0);
    const free = idxs.filter((i) => i !== 0);
    const target = STALE_GROUP_TOTAL_CENTS[group] - (group === "CA" ? FEATURED_AMOUNT_CENTS : 0);
    let done = false;
    for (let attempt = 0; attempt < 500 && !done; attempt++) {
      const raw = new Map<number, number>();
      for (const i of free) {
        const r = AMOUNT_RANGE[kinds[i] as SynthPropertyType];
        raw.set(i, rng.logUniform(r[0], r[1]));
      }
      for (const [a, b] of AMOUNT_PAIRS) if (raw.has(a) && raw.has(b)) raw.set(b, raw.get(a) as number);
      const total = [...raw.values()].reduce((s, x) => s + x, 0);
      const scale = target / 100 / total;
      const lastIdx = free[free.length - 1] as number;
      const cents = new Map<number, number>();
      for (const i of free) cents.set(i, Math.round((raw.get(i) as number) * scale * 100));
      for (const [a, b] of AMOUNT_PAIRS) if (cents.has(a) && cents.has(b)) cents.set(b, cents.get(a) as number);
      const others = free.filter((i) => i !== lastIdx).reduce((s, i) => s + (cents.get(i) as number), 0);
      const last = target - others;
      if (last >= 5000 && last <= 600_000 && [...cents.values()].every((c) => c >= 3000)) {
        cents.set(lastIdx, last);
        for (const [i, c] of cents) out[i] = c;
        done = true;
      }
    }
    if (!done) throw new Error(`could not balance stale amounts for ${group}`);
  }
  return out;
}

function buildStale(rng: Rng, entities: Entity[], anchor: string): { stale: Draft[]; twins: Draft[] } {
  const staleMax = addDays(anchor, -181);
  const start = addDays(anchor, -HISTORY_DAYS);
  const span = daysBetween(start, staleMax);
  const featuredDate = subMonths(anchor, 14);
  const slots: Array<{ entity: Entity; group: StaleGroup }> = [];
  for (const [group, role, n] of STALE_PLAN) {
    const pool = entities.filter((e) => e.role === role && e.staleGroup === group);
    const featured = group === "CA" && role === "vendor" ? pool[0] : undefined;
    const rest = pool.filter((e) => e !== featured);
    const order = featured ? [featured, ...rng.shuffle(rest)] : rng.shuffle(rest);
    for (let j = 0; j < n; j++) slots.push({ entity: order[j % order.length] as Entity, group });
  }
  const kinds = slots.map((s) => KIND_BY_ROLE[s.entity.role]);
  const amounts = staleAmounts(rng, kinds, slots.map((x) => x.group));
  const stale = slots.map((s, i): Draft => {
    const isFeatured = i === 0;
    const firstTxVendor = i === 16 + 2 + 2 + 1;
    let issue = isFeatured
      ? featuredDate
      : firstTxVendor
        ? staleMax
        : prevBusinessDay(addDays(start, rng.int(0, span)));
    if (issue > staleMax) issue = staleMax;
    const d = draft(rng, s.entity, issue, amounts[i] as number, isFeatured ? s.entity.names[0] : undefined);
    if (isFeatured) {
      d.tie = -1;
      d.memo = "Invoice INV-4410 electrical rework";
    }
    return d;
  });
  const vendorIdx = rng.shuffle(
    stale.map((d, i) => [d, i] as const).filter(([d, i]) => i > 0 && d.kind === "vendor_check" && d.entity.style === "full"),
  );
  const twins = vendorIdx.slice(0, 4).map(([orig]): Draft => {
    const issue = prevBusinessDay(addDays(orig.issue, rng.int(5, 30)));
    const t = draft(rng, orig.entity, issue, orig.amount, orig.name);
    t.clearDate = nextBusinessDay(addDays(issue, rng.int(3, 20)));
    return t;
  });
  return { stale, twins };
}

function buildFiller(rng: Rng, entities: Entity[], anchor: string): Draft[] {
  const start = addDays(anchor, -HISTORY_DAYS);
  const out: Draft[] = [];
  for (const e of entities) {
    const n = e.role === "vendor" ? rng.int(6, 11) : e.role === "employee" ? rng.int(3, 5) : rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      let issue = nextBusinessDay(addDays(start, rng.int(0, HISTORY_DAYS)));
      if (issue > anchor) issue = prevBusinessDay(addDays(anchor, -1));
      // The first items of a multi-variant payee use each spelling once, so every variant exists.
      const d = draft(rng, e, issue, 0, e.names.length > 1 ? e.names[i] : undefined);
      d.amount = amountFor(rng, d.kind, e);
      if (d.kind === "vendor_check" && rng.chance(0.045)) {
        d.voided = true;
        const reissue = nextBusinessDay(addDays(issue, rng.int(2, 15)));
        if (reissue <= anchor) {
          const r = draft(rng, e, reissue, d.amount, d.name);
          r.memo = "Reissue - replaces voided check";
          r.clearDate = planClear(rng, reissue, anchor);
          out.push(r);
        }
      } else {
        d.clearDate = planClear(rng, issue, anchor);
      }
      out.push(d);
    }
  }
  return out;
}

/** Recently issued, still-outstanding items (age <= 180 days), including the exact 180-day boundary. */
function buildRecentOutstanding(rng: Rng, entities: Entity[], anchor: string): Draft[] {
  const ages = [180, 179, 175, 160, 150, 140, 120, 100, 90, 75, 61, 45, 30, 12];
  return ages.map((age) => {
    const e = rng.pick(entities);
    const d = draft(rng, e, addDays(anchor, -age), 0);
    d.amount = amountFor(rng, d.kind, e);
    return d;
  });
}

function numberDrafts(all: Draft[]): Map<Draft, string> {
  const nums = new Map<Draft, string>();
  const byDate = (a: Draft, b: Draft) => (a.issue === b.issue ? a.tie - b.tie : a.issue < b.issue ? -1 : 1);
  const checks = all.filter((d) => d.kind === "vendor_check" || d.kind === "payroll_check").sort(byDate);
  const featuredIdx = checks.findIndex((d) => d.tie === -1);
  const base = Number(FEATURED_NUMBER) - featuredIdx;
  checks.forEach((d, i) => nums.set(d, String(base + i)));
  all.filter((d) => d.kind === "customer_credit").sort(byDate).forEach((d, i) => nums.set(d, `CM-${2001 + i}`));
  all.filter((d) => d.kind === "unapplied_cash").sort(byDate).forEach((d, i) => nums.set(d, `UC-${3001 + i}`));
  return nums;
}

function clearDescription(kind: SynthPropertyType, number: string): string {
  if (kind === "payroll_check") return `PAYROLL CHK ${number} PAID`;
  if (kind === "vendor_check") return `CHECK ${number} PAID`;
  return `ACH REFUND ${number}`;
}

export function generateSynthetic(seed: number = DEFAULT_SEED, anchor: string = DEMO_ANCHOR_DATE): SyntheticDataset {
  const entities = buildEntities(createRng(seed, "entities"));
  const { stale, twins } = buildStale(createRng(seed, "stale"), entities, anchor);
  const filler = buildFiller(createRng(seed, "filler"), entities, anchor);
  const recent = buildRecentOutstanding(createRng(seed, "recent"), entities, anchor);
  const all = [...stale, ...twins, ...filler, ...recent];
  const nums = numberDrafts(all);

  const ledger: LedgerRow[] = all.map((d) => ({
    kind: d.kind,
    number: nums.get(d) as string,
    payee_name: d.name,
    ...d.fields,
    amount_cents: d.amount,
    issue_date: d.issue,
    voided: d.voided,
    memo: d.memo,
  }));
  const clears: ClearRow[] = all
    .filter((d) => d.clearDate !== null && !d.voided)
    .map((d) => ({
      check_number: nums.get(d) as string,
      amount_cents: d.amount,
      cleared_date: d.clearDate as string,
      description: clearDescription(d.kind, nums.get(d) as string),
    }));
  ledger.sort((a, b) => (a.issue_date === b.issue_date ? a.number.localeCompare(b.number) : a.issue_date < b.issue_date ? -1 : 1));
  clears.sort((a, b) => (a.cleared_date === b.cleared_date ? a.check_number.localeCompare(b.check_number) : a.cleared_date < b.cleared_date ? -1 : 1));
  return { seed, anchor, company: COMPANY, ledger, clears };
}
