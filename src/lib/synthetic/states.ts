/** US state tables used by the generator and the local labeling helper. */

export const US_STATES: Readonly<Record<string, string>> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri",
  MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio",
  OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina",
  SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  DC: "district of columbia",
};

/** Common abbreviations / variants (lower case, no periods). */
export const STATE_ALIASES: Readonly<Record<string, string>> = {
  ala: "AL", ariz: "AZ", ark: "AR", calif: "CA", cal: "CA", colo: "CO", conn: "CT",
  del: "DE", fla: "FL", ill: "IL", ind: "IN", kan: "KS", kans: "KS", mass: "MA",
  mich: "MI", minn: "MN", miss: "MS", mont: "MT", neb: "NE", nebr: "NE", nev: "NV",
  okla: "OK", ore: "OR", oreg: "OR", penn: "PA", penna: "PA", tenn: "TN", tex: "TX",
  wash: "WA", wis: "WI", wisc: "WI", wyo: "WY",
};

export const MILITARY_STATE_CODES = new Set(["AA", "AE", "AP"]);
export const CANADIAN_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name, code]),
);

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      (dp[i] as number[])[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        (dp[i] as number[])[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + cost,
      );
    }
  }
  return (dp[a.length] as number[])[b.length] as number;
}

export interface NormalizeOptions {
  /** Allow typo tolerance against full state names (state field only). */
  fuzzy?: boolean;
  /** Accept a bare two-letter code in any case (state field only). */
  anyCaseCode?: boolean;
}

/** Map a token such as "CA", "Calif.", "california", "Califronia" to a state code, or null. */
export function normalizeStateToken(raw: string, opts: NormalizeOptions = {}): string | null {
  const token = raw.trim().replace(/\./g, "").replace(/\s+/g, " ");
  if (!token) return null;
  if (/^[A-Za-z]{2}$/.test(token)) {
    const upper = token.toUpperCase();
    if (!(upper in US_STATES)) return null;
    return opts.anyCaseCode || token === upper ? upper : null;
  }
  const lower = token.toLowerCase();
  const alias = STATE_ALIASES[lower];
  if (alias) return alias;
  const exact = NAME_TO_CODE.get(lower);
  if (exact) return exact;
  if (!opts.fuzzy || lower.length < 6) return null;
  const allowed = lower.length >= 8 ? 2 : 1;
  let best: { code: string; d: number } | null = null;
  let tie = false;
  for (const [name, code] of NAME_TO_CODE) {
    if (Math.abs(name.length - lower.length) > allowed) continue;
    const d = levenshtein(lower, name);
    if (d > allowed) continue;
    if (!best || d < best.d) {
      best = { code, d };
      tie = false;
    } else if (d === best.d) tie = true;
  }
  return best && !tie ? best.code : null;
}

type ZipRange = readonly [number, number, string];

/** USPS 3-digit ZIP prefix ranges. 'MIL' = military, 'TERR' = territory (never a state here). */
const ZIP3_RANGES: readonly ZipRange[] = [
  [5, 5, "NY"], [6, 9, "TERR"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [90, 99, "MIL"], [100, 149, "NY"],
  [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"], [201, 201, "VA"], [202, 205, "DC"],
  [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 339, "FL"], [340, 340, "MIL"], [341, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"],
  [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"],
  [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"],
  [900, 961, "CA"], [962, 966, "MIL"], [967, 968, "HI"], [969, 969, "TERR"], [970, 979, "OR"],
  [980, 994, "WA"], [995, 999, "AK"],
];

/** Digits of a ZIP, normalised to 5 (4-digit ZIPs lost a leading zero), or null. */
export function normalizeZip(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 4) return `0${digits}`;
  if (digits.length === 5 || digits.length === 9) return digits.slice(0, 5);
  return null;
}

/** US state for a ZIP, or null (unknown prefix, territory, military). */
export function zipToState(zip: string): string | null {
  const z = normalizeZip(zip);
  if (!z) return null;
  const p = Number(z.slice(0, 3));
  const hit = ZIP3_RANGES.find(([lo, hi]) => p >= lo && p <= hi);
  if (!hit) return null;
  return hit[2] === "MIL" || hit[2] === "TERR" ? null : hit[2];
}

export function isMilitaryZip(zip: string): boolean {
  const z = normalizeZip(zip);
  if (!z) return false;
  const p = Number(z.slice(0, 3));
  return ZIP3_RANGES.some(([lo, hi, c]) => c === "MIL" && p >= lo && p <= hi);
}
