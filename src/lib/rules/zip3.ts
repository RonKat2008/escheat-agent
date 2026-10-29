/**
 * ZIP3 prefix -> state/area table.
 *
 * Source: USPS ZIP Code prefix allocation (the "3-Digit ZIP Code Prefix" ranges as published in the
 * USPS Domestic Mail Manual / National Five-Digit ZIP Code & Post Office Directory, Pub. 65). Written
 * from those published ranges. A few prefixes straddle a state border at ZIP5 level; this table maps the
 * prefix to the state that owns most of it. A ZIP-derived state is therefore the weakest evidence in
 * resolveOwnerState (explicit state and address-line state always win).
 *
 * Non-state areas are tagged: PR, VI, GU (territories), AA/AE/AP (military mail).
 */

export type ZipArea = string; // 2-letter state, DC, territory (PR/VI/GU/MP/AS), or military (AA/AE/AP)

/** [startInclusive, endInclusive, area] */
const RANGES: ReadonlyArray<readonly [number, number, ZipArea]> = [
  [5, 5, "NY"], // Holtsville IRS
  [6, 7, "PR"],
  [8, 8, "VI"],
  [9, 9, "PR"],
  [10, 27, "MA"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [90, 99, "AE"], // 090-099 Army/Air Force Post Office, Europe
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 339, "FL"],
  [340, 340, "AA"], // Americas military
  [341, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 459, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [569, 569, "DC"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 731, "OK"],
  [733, 733, "TX"], // Austin IRS
  [734, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [885, 885, "TX"], // El Paso
  [889, 898, "NV"],
  [900, 961, "CA"],
  [962, 966, "AP"], // Pacific military
  [967, 968, "HI"],
  [969, 969, "GU"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

const TABLE: Map<string, ZipArea> = (() => {
  const t = new Map<string, ZipArea>();
  for (const [lo, hi, area] of RANGES) {
    for (let p = lo; p <= hi; p++) t.set(String(p).padStart(3, "0"), area);
  }
  return t;
})();

/** Extract a 5-digit (or ZIP+4) US ZIP from free text, or null. */
export function normalizeZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const m = /\b(\d{5})(?:-\d{4})?\b/.exec(zip.trim());
  return m ? m[1]! : null;
}

/** Area for a ZIP (any form with a 5-digit core), or null when the prefix is unassigned. */
export function zipToArea(zip: string | null | undefined): ZipArea | null {
  const z = normalizeZip(zip);
  if (!z) return null;
  return TABLE.get(z.slice(0, 3)) ?? null;
}
