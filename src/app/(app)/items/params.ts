import { createLoader, createParser, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { LIST_SORT_VALUES, PROPERTY_TYPE_VALUES, STALE_STATUS_VALUES } from "@/lib/queries/enums";
import { VIEW_IDS } from "./view-model";

export const SORT_VALUES = LIST_SORT_VALUES;

/**
 * Hand-typed or stale URLs must never reach the query layer: an unknown value parses to null (the filter is ignored)
 * instead of throwing a ZodError during the server render. Each parser mirrors what ListFiltersSchema accepts.
 */
const parseAsStateCode = createParser({
  parse: (v) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null),
  serialize: (v) => v,
});
const parseAsAgeDays = createParser({
  parse: (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isSafeInteger(n) && n > 0 && String(n) === v.trim() ? n : null;
  },
  serialize: (v) => String(v),
});

/**
 * On/off flag. Accepts "1" as well as "true": dashboard links use `?overdue=1` / `?review=1`, which nuqs'
 * parseAsBoolean reads as false (silently dropping the filter). Anything else is ignored. Written back as "true".
 */
const parseAsFlag = createParser({
  parse: (v) => (v === "1" || v.toLowerCase() === "true" ? true : null),
  serialize: () => "true",
});

/** URL state for /items. Shared by the server loader and the client hooks. */
export const itemsParsers = {
  state: parseAsStateCode,
  status: parseAsStringLiteral(STALE_STATUS_VALUES),
  type: parseAsStringLiteral(PROPERTY_TYPE_VALUES),
  minAge: parseAsAgeDays,
  review: parseAsFlag,
  /** Only items with a missed deadline (decided by src/lib/overdue.ts). */
  overdue: parseAsFlag,
  /** "none": only items in states with no rules loaded (not covered yet). */
  coverage: parseAsStringLiteral(["none"] as const),
  q: parseAsString,
  sort: parseAsStringLiteral(SORT_VALUES),
  item: parseAsString,
  /** Saved view (Loop Bar links: needs-action, draft-ready). Unknown values are ignored (All). */
  view: parseAsStringLiteral(VIEW_IDS),
};

export const loadItemsParams = createLoader(itemsParsers);

export const AGE_OPTIONS = [
  { value: "", label: "Any age" },
  { value: "365", label: "Over 1 year" },
  { value: "730", label: "Over 2 years" },
  { value: "1095", label: "Over 3 years" },
] as const;
