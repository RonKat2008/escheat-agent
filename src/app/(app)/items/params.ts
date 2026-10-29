import { createLoader, parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const SORT_VALUES = ["age_desc", "age_asc", "amount_desc", "amount_asc", "payee_asc", "deadline_asc"] as const;

/** URL state for /items. Shared by the server loader and the client hooks. */
export const itemsParsers = {
  state: parseAsString,
  status: parseAsString,
  type: parseAsString,
  minAge: parseAsInteger,
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
