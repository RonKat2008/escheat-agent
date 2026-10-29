import { jaroWinkler } from "./similarity";

export interface AddressParts {
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type AddressAgreement = "match" | "conflict" | "unknown";

const STREET_ABBR: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  blvd: "boulevard",
  dr: "drive",
  ln: "lane",
  ct: "court",
  hwy: "highway",
  pkwy: "parkway",
  ste: "suite",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
};

const STREET_MATCH = 0.92;

export function normalizeStreet(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((t) => STREET_ABBR[t] ?? t)
    .join(" ");
}

const zip5 = (z?: string | null) => (z ?? "").replace(/\D/g, "").slice(0, 5);
const clean = (s?: string | null) => (s ?? "").trim();

/**
 * Do two addresses agree? Missing data is "unknown", never a conflict. Street similarity
 * decides when both have streets; otherwise zip, then state, are compared.
 */
export function addressAgreement(a: AddressParts, b: AddressParts): AddressAgreement {
  const sa = normalizeStreet(clean(a.addressLine));
  const sb = normalizeStreet(clean(b.addressLine));
  const za = zip5(a.zip);
  const zb = zip5(b.zip);
  if (sa && sb) {
    if (jaroWinkler(sa, sb) >= STREET_MATCH) return "match";
    return za.length === 5 && za === zb ? "unknown" : "conflict";
  }
  if (za.length === 5 && zb.length === 5) return za === zb ? "match" : "conflict";
  const sta = clean(a.state).toUpperCase();
  const stb = clean(b.state).toUpperCase();
  if (sta && stb) return sta === stb ? "unknown" : "conflict";
  return "unknown";
}
