/**
 * Which state gets the property? Texas v. New Jersey, 379 U.S. 674 (1965) as codified in the
 * priority rules used by every state's unclaimed property act:
 *   1. the state of the owner's last known address, if one can be determined;
 *   2. otherwise the holder's state of incorporation.
 *
 * Fully deterministic. "Can be determined" means: an explicit state field, a state named in the
 * address/city text, or a ZIP prefix that maps to one of the 50 states or DC. Territories (PR, GU, VI,
 * AS, MP), military mail (AA/AE/AP) and foreign addresses are NOT states for this purpose: they fall
 * through to the holder's state of incorporation (the "address in a jurisdiction that does not provide
 * for escheat" branch of the rule is handled the same way and is documented, not modelled).
 */

import { normalizeZip, zipToArea } from "./zip3";

export const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
} as const;

export type UsStateCode = keyof typeof US_STATES;

export const isUsState = (code: string): code is UsStateCode =>
  Object.prototype.hasOwnProperty.call(US_STATES, code);

const TERRITORIES: Record<string, string> = {
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands", UM: "U.S. Minor Outlying Islands",
};
const MILITARY: Record<string, string> = {
  AA: "Armed Forces Americas", AE: "Armed Forces Europe", AP: "Armed Forces Pacific",
};
/** Canadian provinces/territories (not state-like codes that collide with US ones). */
const FOREIGN_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const FOREIGN_WORDS = [
  "canada", "mexico", "united kingdom", "england", "scotland", "wales", "ireland", "germany", "france",
  "india", "china", "japan", "australia", "brazil", "israel", "singapore", "netherlands", "spain", "italy",
  "ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia",
  "new brunswick", "newfoundland", "uk",
];

/** Traditional abbreviations -> code. */
const TRADITIONAL: Record<string, string> = {
  ala: "AL", ariz: "AZ", ark: "AR", calif: "CA", cal: "CA", colo: "CO", conn: "CT", del: "DE",
  fla: "FL", ill: "IL", ind: "IN", kan: "KS", kans: "KS", ky: "KY", la: "LA", mass: "MA", md: "MD",
  mich: "MI", minn: "MN", miss: "MS", mo: "MO", mont: "MT", neb: "NE", nebr: "NE", nev: "NV",
  okla: "OK", ore: "OR", oreg: "OR", penn: "PA", penna: "PA", tenn: "TN", tex: "TX", wash: "WA",
  wis: "WI", wisc: "WI", wyo: "WY", dc: "DC",
};

/** Traditional abbreviations safe to accept without a trailing period. */
const UNDOTTED_SAFE: ReadonlySet<string> = new Set([
  "calif", "tex", "ariz", "colo", "conn", "fla", "okla", "tenn", "penna", "mich", "minn",
  "wisc", "nebr", "oreg", "mass",
]);

const NAME_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, name] of Object.entries(US_STATES)) m.set(name.toLowerCase(), code);
  m.set("washington dc", "DC");
  m.set("washington d c", "DC");
  m.set("district of columbia", "DC");
  for (const [code, name] of Object.entries(TERRITORIES)) m.set(name.toLowerCase(), code);
  m.set("virgin islands", "VI");
  m.set("us virgin islands", "VI");
  m.set("u s virgin islands", "VI");
  m.set("guam", "GU");
  return m;
})();

type Token =
  | { kind: "state"; code: UsStateCode }
  | { kind: "territory"; code: string }
  | { kind: "military"; code: string }
  | { kind: "foreign"; code: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, (c) => (c === "." ? "" : " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tokenFromCode(code: string): Token | null {
  if (isUsState(code)) return { kind: "state", code };
  if (code === "DC") return { kind: "state", code: "DC" as UsStateCode };
  if (code in TERRITORIES) return { kind: "territory", code };
  if (code in MILITARY) return { kind: "military", code };
  if (FOREIGN_CODES.has(code)) return { kind: "foreign", code };
  return null;
}

/**
 * Interpret a string that is *meant to be* a state: "CA", "ca", "Calif.", "Tex", "texas",
 * "D.C.", "Puerto Rico", "AE", "Canada".
 */
export function parseStateToken(raw: string | null | undefined): Token | null {
  if (!raw) return null;
  const n = norm(raw);
  if (!n) return null;
  const compact = n.replace(/ /g, "");
  if (/^[a-z]{2}$/.test(compact) && n.length <= 4) {
    const t = tokenFromCode(compact.toUpperCase());
    if (t) return t;
  }
  if (compact === "dc") return { kind: "state", code: "DC" as UsStateCode };
  const trad = TRADITIONAL[compact];
  if (trad) return tokenFromCode(trad);
  const full = NAME_TO_CODE.get(n);
  if (full) return tokenFromCode(full);
  if (FOREIGN_WORDS.includes(n)) return { kind: "foreign", code: n };
  return null;
}

/** Foreign marker anywhere in free text (country names, Canadian postal codes). */
function hasForeignMarker(text: string): boolean {
  if (/\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/.test(text.toUpperCase())) return true; // Canadian postal code
  const n = ` ${norm(text)} `;
  return FOREIGN_WORDS.some((w) => n.includes(` ${w} `));
}

/** Find a trailing state in a free-text address/city line ("Austin, TX 78701", "Sacramento, Calif."). */
function stateFromText(text: string | null | undefined): Token | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ") // drop ZIPs
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,\s]+$/, "");
  if (!cleaned) return null;

  // Last comma-separated segment may be a state in any form.
  const segs = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  if (segs.length > 1) {
    const t = parseStateToken(segs[segs.length - 1]!);
    if (t) return t;
  }
  // Last whitespace token: only accept an UPPERCASE 2-letter code or a dotted traditional abbreviation
  // (avoids "Sacramento in", "Salem or", "Hope me").
  const words = cleaned.split(" ");
  const last = words[words.length - 1]!;
  if (/^[A-Z]{2}$/.test(last) || /^D\.?C\.?$/.test(last)) {
    const t = parseStateToken(last);
    if (t) return t;
  }
  if (/^[A-Z][a-z]+\.$/.test(last)) {
    const t = parseStateToken(last);
    if (t) return t;
  }
  // Undotted traditional abbreviations, limited to ones that are not ordinary words or
  // common place-name parts ("San Antonio Tex", "Fresno Calif"). Excludes e.g. Wash, Miss,
  // Ill, Ind, Del, Mo, La, Ore, Cal, Ark, Kan, Nev, Mont, Ala, Wyo, Md, Ky.
  if (words.length > 1 && /^[A-Z][a-z]+$/.test(last) && UNDOTTED_SAFE.has(last.toLowerCase())) {
    const t = parseStateToken(last);
    if (t) return t;
  }
  // Multi-word state name at the end after a city ("Columbus Ohio", "Reno New Mexico"): require >= 2 words
  // or an unambiguous single name, and only when preceded by something (a bare city is never a state).
  for (let take = 3; take >= 1; take--) {
    if (words.length <= take) continue;
    const cand = words.slice(-take).join(" ");
    const code = NAME_TO_CODE.get(norm(cand));
    if (code && !(take === 1 && (code === "WA" || code === "DC" || code === "IN"))) {
      return tokenFromCode(code);
    }
  }
  return null;
}

export type OwnerStateReason =
  | "explicit_state"
  | "address_text"
  | "zip"
  | "conflict"
  | "no_address"
  | "undetermined"
  | "territory"
  | "military"
  | "foreign";

export interface OwnerStateInput {
  payee: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  holder: { stateOfIncorporation: string };
}

export interface OwnerStateResult {
  state: string;
  basis: "address" | "incorporation";
  /**
   * Machine-readable why. 'conflict' = address state chosen but explicit state and ZIP disagreed
   * (explicit state wins). `detail` is the human sentence.
   */
  reason: OwnerStateReason;
  detail: string;
}

function holderState(raw: string): string {
  const t = parseStateToken(raw);
  if (t && (t.kind === "state" || t.kind === "territory")) return t.code;
  return raw.trim().toUpperCase();
}

export function resolveOwnerState(input: OwnerStateInput): OwnerStateResult {
  const { payee, holder } = input;
  const inc = holderState(holder.stateOfIncorporation);
  const fallback = (reason: OwnerStateReason, detail: string): OwnerStateResult => ({
    state: inc,
    basis: "incorporation",
    reason,
    detail: `${detail} Using holder's state of incorporation (${inc}).`,
  });

  const explicit = parseStateToken(payee.state);
  const fromCity = stateFromText(payee.city);
  const fromAddr = stateFromText(payee.address);
  const text = fromCity ?? fromAddr;
  const zipArea = zipToArea(payee.zip) ?? zipToArea(payee.address) ?? zipToArea(payee.city);
  const zipToken = zipArea ? tokenFromCode(zipArea) : null;

  const everything = [payee.address, payee.city, payee.state, payee.zip].filter(Boolean).join(" ");
  const anyAddress = Boolean(
    (payee.address ?? "").trim() || (payee.city ?? "").trim() || (payee.state ?? "").trim() || normalizeZip(payee.zip),
  );
  if (!anyAddress) return fallback("no_address", "No last known address.");

  // Non-state signals win over weaker evidence: a payee abroad / in a territory is not a state payee.
  const primary = explicit ?? text;
  if (primary && primary.kind === "foreign") return fallback("foreign", "Foreign address.");
  if (primary && primary.kind === "territory") {
    return fallback("territory", `Address is in a U.S. territory (${primary.code}), not a state.`);
  }
  if (primary && primary.kind === "military") {
    return fallback("military", `Military mail address (${primary.code}), not a state.`);
  }
  if (!primary && hasForeignMarker(everything)) return fallback("foreign", "Foreign address.");

  if (explicit?.kind === "state") {
    const code = explicit.code;
    const contradicted =
      (text?.kind === "state" && text.code !== code) || (zipToken?.kind === "state" && zipToken.code !== code);
    if (contradicted) {
      return {
        state: code,
        basis: "address",
        reason: "conflict",
        detail: `Explicit state ${code} conflicts with ${text?.kind === "state" && text.code !== code ? `address text (${text.code})` : `ZIP ${normalizeZip(payee.zip)} (${zipToken?.code})`}; explicit state preferred.`,
      };
    }
    return { state: code, basis: "address", reason: "explicit_state", detail: `Explicit state ${code}.` };
  }

  if (text?.kind === "state") {
    if (zipToken?.kind === "state" && zipToken.code !== text.code) {
      return {
        state: text.code,
        basis: "address",
        reason: "conflict",
        detail: `Address text state ${text.code} conflicts with ZIP (${zipToken.code}); address text preferred.`,
      };
    }
    return { state: text.code, basis: "address", reason: "address_text", detail: `State ${text.code} found in address text.` };
  }

  if (zipToken?.kind === "state") {
    return { state: zipToken.code, basis: "address", reason: "zip", detail: `State ${zipToken.code} inferred from ZIP prefix.` };
  }
  if (zipToken?.kind === "territory") return fallback("territory", `ZIP is in ${zipToken.code}, not a state.`);
  if (zipToken?.kind === "military") return fallback("military", `ZIP is military mail (${zipToken.code}).`);

  return fallback("undetermined", "No state could be determined deterministically from the address.");
}
