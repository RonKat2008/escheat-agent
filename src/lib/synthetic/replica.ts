import { CITY_TABLE, FIRST_NAMES, LAST_NAMES, VENDOR_PREFIXES, VENDOR_TRADES } from "./names";
import { createRng, type Rng } from "./prng";

export const REPLICA_STATES = ["CA", "DE", "TX"] as const;
export type ReplicaState = (typeof REPLICA_STATES)[number];

export interface ReplicaRecord {
  property_id: string;
  /** State whose (replica) unclaimed-property database "holds" the property. */
  state_held: ReplicaState;
  owner_name: string;
  owner_city: string;
  owner_state: string;
  owner_zip: string;
  property_type: string;
  amount_cents: number;
  reported_by: string;
  reported_year: number;
  synthetic: true;
}

export interface ReplicaFixture {
  synthetic: true;
  notice: string;
  seed: number;
  northwind_record_id: string;
  records: Record<ReplicaState, ReplicaRecord[]>;
}

export const NORTHWIND_RECORD = {
  state: "TX" as ReplicaState,
  owner_name: "NORTHWIND FIXTURES INC",
  amount_cents: 118_000,
};

const PROPERTY_TYPES = [
  "Accounts payable / vendor check",
  "Wages / payroll check",
  "Customer overpayment / refund",
  "Utility deposit",
  "Credit balance",
  "Miscellaneous outstanding check",
];
const SUFFIXES = ["LLC", "INC", "CO", "CORP"];

function upper(s: string): string {
  return s.toUpperCase();
}

function owner(rng: Rng): string {
  if (rng.chance(0.55)) return `${upper(rng.pick(LAST_NAMES))}, ${upper(rng.pick(FIRST_NAMES))}`;
  return `${upper(rng.pick(VENDOR_PREFIXES))} ${upper(rng.pick(VENDOR_TRADES)[0])} ${rng.pick(SUFFIXES)}`;
}

function holder(rng: Rng): string {
  return `${upper(rng.pick(VENDOR_PREFIXES))} ${rng.pick(["HOLDINGS", "RETAIL GROUP", "UTILITIES", "SERVICES", "PARTNERS"])} ${rng.pick(SUFFIXES)}`;
}

function makeRecord(rng: Rng, state: ReplicaState, n: number): ReplicaRecord {
  const ownerState = rng.chance(0.75) ? state : rng.pick(["NY", "WA", "IL", "FL", "AZ", "GA", "OR"]);
  const [city, prefix] = rng.pick(CITY_TABLE[ownerState] ?? CITY_TABLE.DE!);
  let cents = Math.round(rng.logUniform(15, 4500) * 100);
  if (cents === NORTHWIND_RECORD.amount_cents) cents += 7;
  return {
    property_id: `SYN-${state}-${String(rng.int(1_000_000, 9_999_999))}-${String(n).padStart(2, "0")}`,
    state_held: state,
    owner_name: owner(rng),
    owner_city: city,
    owner_state: ownerState,
    owner_zip: `${prefix}${rng.int(10, 99)}`,
    property_type: rng.pick(PROPERTY_TYPES),
    amount_cents: cents,
    reported_by: holder(rng),
    reported_year: rng.int(2021, 2025),
    synthetic: true,
  };
}

export function generateReplicaFixture(seed: number): ReplicaFixture {
  const records = {} as Record<ReplicaState, ReplicaRecord[]>;
  let northwindId = "";
  for (const state of REPLICA_STATES) {
    const rng = createRng(seed, `replica-${state}`);
    const list: ReplicaRecord[] = [];
    for (let i = 1; i <= 28; i++) list.push(makeRecord(rng, state, i));
    // Near-miss decoys (different names / amounts) to exercise fuzzy matching without ambiguity.
    const decoyName = {
      CA: "NORTHWIND FOODS LLC",
      DE: "NORTHWEST FIXTURES INC",
      TX: "NORTH WIND FIXTURE SUPPLY",
    }[state];
    const decoy = makeRecord(rng, state, 29);
    list.push({ ...decoy, owner_name: decoyName, amount_cents: { CA: 64_010, DE: 9_500, TX: 21_250 }[state] });
    if (state === NORTHWIND_RECORD.state) {
      const base = makeRecord(rng, state, 30);
      const nw: ReplicaRecord = {
        ...base,
        property_id: `SYN-TX-4173850-30`,
        owner_name: NORTHWIND_RECORD.owner_name,
        owner_city: "Austin",
        owner_state: "TX",
        owner_zip: "78701",
        property_type: "Accounts payable / vendor check",
        amount_cents: NORTHWIND_RECORD.amount_cents,
        reported_by: "HOLLISFORD RETAIL GROUP LLC",
        reported_year: 2024,
      };
      northwindId = nw.property_id;
      list.push(nw);
    } else {
      list.push(makeRecord(rng, state, 30));
    }
    records[state] = list;
  }
  return {
    synthetic: true,
    notice:
      "SYNTHETIC unclaimed-property records for the replica state search portals. Fictional owners, holders and IDs only; not real state data.",
    seed,
    northwind_record_id: northwindId,
    records,
  };
}
