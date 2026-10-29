import { CITY_TABLE, AMBIGUOUS_CITIES, CUSTOMER_KINDS, CUSTOMER_PREFIXES, FIRST_NAMES, LAST_NAMES, STREET_NAMES, STREET_SUFFIXES, VENDOR_PREFIXES, VENDOR_SUFFIXES, VENDOR_TRADES } from "./names";
import type { Rng } from "./prng";

export type Role = "vendor" | "employee" | "cust_credit" | "cust_unapplied";
export type Style =
  | "full"
  | "zip_only"
  | "city_only"
  | "blank"
  | "state_in_line"
  | "city_with_state"
  | "foreign";
export type StaleGroup = "CA" | "TX" | "DE";

export interface Address {
  line: string;
  city: string;
  state: string;
  zip: string;
}

export interface Entity {
  id: string;
  role: Role;
  names: string[];
  nameWeights: number[];
  state: string;
  style: Style;
  addr: Address;
  /** Set when the entity is in the stale pool for that owner-state group. */
  staleGroup: StaleGroup | null;
  fixedAmountsCents: number[];
}

export interface AddressFields {
  payee_address: string;
  payee_city: string;
  payee_state: string;
  payee_zip: string;
}

/** Render the entity's true address through its (possibly degraded) style. */
export function renderAddress(addr: Address, style: Style): AddressFields {
  switch (style) {
    case "full":
      return { payee_address: addr.line, payee_city: addr.city, payee_state: addr.state, payee_zip: addr.zip };
    case "zip_only":
      return { payee_address: "", payee_city: "", payee_state: "", payee_zip: addr.zip };
    case "city_only":
      return { payee_address: "", payee_city: addr.city, payee_state: "", payee_zip: "" };
    case "blank":
      return { payee_address: "", payee_city: "", payee_state: "", payee_zip: "" };
    case "state_in_line":
      return {
        payee_address: `${addr.line}, ${addr.city} ${addr.state} ${addr.zip}`,
        payee_city: "",
        payee_state: "",
        payee_zip: "",
      };
    case "city_with_state":
      return { payee_address: addr.line, payee_city: `${addr.city} Tex`, payee_state: "", payee_zip: "" };
    case "foreign":
      return { payee_address: addr.line, payee_city: addr.city, payee_state: addr.state, payee_zip: addr.zip };
  }
}

export function makeAddress(rng: Rng, state: string): Address {
  const [city, prefix] = rng.pick(CITY_TABLE[state] ?? CITY_TABLE.DE!);
  const street = `${rng.int(100, 9899)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`;
  const line = rng.chance(0.25) ? `${street}, Suite ${rng.int(100, 420)}` : street;
  return { line, city, state, zip: `${prefix}${rng.int(10, 99)}` };
}

export const FOREIGN_ADDRESS: Address = {
  line: "5500 Example Gateway Road",
  city: "Mississauga",
  state: "ON",
  zip: "L5B 2C9",
};

interface Spec {
  role: Role;
  state: string;
  style: Style;
  staleGroup?: StaleGroup;
  /** Pin the base name instead of drawing one (used for the featured vendor). */
  fixedBase?: [string, string];
}

function vendorNames(prefix: string, trade: readonly [string, string], rng: Rng, multi: boolean): string[] {
  const base = `${prefix} ${trade[0]}`;
  if (!multi) return [base];
  return [base, `${base} ${rng.pick(VENDOR_SUFFIXES)}`, `${prefix.toUpperCase()} ${trade[1]}`];
}

/** Build the whole fictional payee universe. Order of specs is stable => deterministic. */
export function buildEntities(rng: Rng): Entity[] {
  const specs: Spec[] = [];
  const add = (n: number, s: Spec) => {
    for (let i = 0; i < n; i++) specs.push(s);
  };
  const v = (state: string, style: Style, staleGroup?: StaleGroup): Spec => ({
    role: "vendor",
    state,
    style,
    ...(staleGroup ? { staleGroup } : {}),
  });

  // California vendors (stale pool). First is the featured payee.
  specs.push({ ...v("CA", "full", "CA"), fixedBase: ["Bayline", "Electric"] });
  add(11, v("CA", "full", "CA"));
  add(2, v("CA", "zip_only", "CA"));
  // Texas vendors (stale pool).
  add(8, v("TX", "full", "TX"));
  add(1, v("TX", "zip_only", "TX"));
  add(1, v("TX", "state_in_line", "TX"));
  add(1, v("TX", "city_with_state", "TX"));
  // Delaware-group vendors (stale pool): DE address, no address, city only, foreign.
  add(3, v("DE", "full", "DE"));
  add(3, v("DE", "blank", "DE"));
  add(1, v("DE", "city_only", "DE"));
  add(1, v("DE", "foreign", "DE"));
  // Non-stale universe: other states plus extra blank-address vendors.
  for (const [st, n] of [["NY", 4], ["WA", 4], ["IL", 4], ["FL", 4], ["AZ", 2], ["GA", 2], ["OR", 2]] as const) {
    add(n, v(st, "full"));
  }
  add(1, v("NY", "zip_only"));
  add(3, v("DE", "blank"));
  add(2, v("CA", "full"));
  add(2, v("TX", "full"));

  // Employees (payroll)
  add(2, { role: "employee", state: "CA", style: "full", staleGroup: "CA" });
  add(2, { role: "employee", state: "TX", style: "full", staleGroup: "TX" });
  add(1, { role: "employee", state: "DE", style: "full", staleGroup: "DE" });
  add(3, { role: "employee", state: "NY", style: "full" });
  add(2, { role: "employee", state: "WA", style: "full" });
  // Customers with refund credits
  add(2, { role: "cust_credit", state: "CA", style: "full", staleGroup: "CA" });
  add(2, { role: "cust_credit", state: "TX", style: "full", staleGroup: "TX" });
  add(1, { role: "cust_credit", state: "DE", style: "city_only", staleGroup: "DE" });
  add(4, { role: "cust_credit", state: "IL", style: "full" });
  add(3, { role: "cust_credit", state: "FL", style: "full" });
  add(2, { role: "cust_credit", state: "NY", style: "zip_only" });
  // Customers with unapplied cash
  add(1, { role: "cust_unapplied", state: "CA", style: "full", staleGroup: "CA" });
  add(1, { role: "cust_unapplied", state: "TX", style: "full", staleGroup: "TX" });
  add(1, { role: "cust_unapplied", state: "DE", style: "blank", staleGroup: "DE" });
  add(3, { role: "cust_unapplied", state: "WA", style: "full" });
  add(3, { role: "cust_unapplied", state: "AZ", style: "full" });

  const prefixes = rng.shuffle(VENDOR_PREFIXES.filter((p) => p !== "Bayline"));
  const custPrefixes = rng.shuffle(CUSTOMER_PREFIXES);
  const usedPeople = new Set<string>();
  let vi = 0;
  let ci = 0;
  return specs.map((spec, i): Entity => {
    const id = `${spec.role}-${String(i + 1).padStart(3, "0")}`;
    const addr = spec.style === "foreign" ? FOREIGN_ADDRESS : makeAddress(rng, spec.state);
    if (spec.style === "city_only") addr.city = rng.pick(AMBIGUOUS_CITIES);
    let names: string[];
    let weights: number[];
    let fixedAmountsCents: number[] = [];
    if (spec.role === "vendor") {
      const trade = spec.fixedBase ? ([spec.fixedBase[1], "ELEC"] as const) : rng.pick(VENDOR_TRADES);
      const prefix = spec.fixedBase ? spec.fixedBase[0] : (prefixes[vi++] as string);
      const multi = spec.fixedBase !== undefined || rng.chance(0.55);
      names = vendorNames(prefix, trade, rng, multi);
      if (spec.fixedBase) names[1] = `${names[0]} Inc.`;
      weights = multi ? [0.6, 0.25, 0.15] : [1];
      if (rng.chance(0.25)) fixedAmountsCents = [rng.pick([125000, 185000, 240000, 310000, 89500])];
    } else if (spec.role === "employee") {
      let name = "";
      do name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      while (usedPeople.has(name));
      usedPeople.add(name);
      names = [name];
      weights = [1];
    } else {
      names = [`${custPrefixes[ci++ % custPrefixes.length]} ${rng.pick(CUSTOMER_KINDS)}${i % 3 === 0 ? " LLC" : ""}`];
      weights = [1];
    }
    return {
      id,
      role: spec.role,
      names,
      nameWeights: weights,
      state: spec.state,
      style: spec.style,
      addr,
      staleGroup: spec.staleGroup ?? null,
      fixedAmountsCents,
    };
  });
}
