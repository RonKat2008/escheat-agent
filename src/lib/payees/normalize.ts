/** Explicit abbreviation table: only these expansions are ever applied. */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  elec: "electric",
  elect: "electric",
  mfg: "manufacturing",
  svc: "services",
  svcs: "services",
  intl: "international",
  mgmt: "management",
  bros: "brothers",
  assn: "association",
  assoc: "associates",
  dept: "department",
  ctr: "center",
  mech: "mechanical",
  plmbg: "plumbing",
  constr: "construction",
  const: "construction",
  dist: "distributing",
  prop: "properties",
  props: "properties",
  ent: "enterprises",
  grp: "group",
  sys: "systems",
  eqpt: "equipment",
  equip: "equipment",
  supp: "supply",
  sply: "supply",
};

/** Legal-entity suffixes stripped from the END of a name (repeatedly). */
export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "pllc",
  "plc",
  "pc",
]);

/** Lowercased, punctuation-free tokens with abbreviations expanded and legal suffixes dropped. */
export function normalizeTokens(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let tokens = cleaned === "" ? [] : cleaned.split(" ");
  if (tokens[0] === "the" && tokens.length > 1) tokens = tokens.slice(1);
  tokens = tokens.map((t) => ABBREVIATIONS[t] ?? t);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens;
}

export function normalizeName(name: string): string {
  return normalizeTokens(name).join(" ");
}
