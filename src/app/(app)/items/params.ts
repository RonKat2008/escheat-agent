import { createLoader, createParser, parseAsBoolean, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { PropertyTypeSchema, SortSchema, StaleStatusSchema } from "@/lib/queries/schemas";

export const SORT_VALUES = SortSchema.options;

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

/** URL state for /items. Shared by the server loader and the client hooks. */
export const itemsParsers = {
  state: parseAsStateCode,
  status: parseAsStringLiteral(StaleStatusSchema.options),
  type: parseAsStringLiteral(PropertyTypeSchema.options),
  minAge: parseAsAgeDays,
  review: parseAsBoolean,
  q: parseAsString,
  sort: parseAsStringLiteral(SORT_VALUES),
  item: parseAsString,
};

export const loadItemsParams = createLoader(itemsParsers);

export const AGE_OPTIONS = [
  { value: "", label: "Any age" },
  { value: "365", label: "Over 1 year" },
  { value: "730", label: "Over 2 years" },
  { value: "1095", label: "Over 3 years" },
] as const;
