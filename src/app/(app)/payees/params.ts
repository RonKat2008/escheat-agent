import { createLoader, parseAsInteger, parseAsString } from "nuqs/server";

/** URL state for /payees. Shared by the server loader and the client hooks. */
export const payeesParsers = {
  q: parseAsString,
  state: parseAsString,
  show: parseAsString,
  basis: parseAsString,
  payee: parseAsString,
  page: parseAsInteger,
};

export const loadPayeesParams = createLoader(payeesParsers);

/** The default view (no `show` in the URL) is "open". */
export const DEFAULT_SHOW = "open";

export const SHOW_OPTIONS = [
  { value: "open", label: "Has open items" },
  { value: "review", label: "Needs review" },
  { value: "aliases", label: "Has aliases" },
  { value: "human", label: "Human-reviewed" },
  { value: "all", label: "All payees" },
] as const;

export const BASIS_OPTIONS = [
  { value: "exact", label: "Exact" },
  { value: "rule", label: "Rule" },
  { value: "model", label: "Model" },
  { value: "human", label: "Human" },
] as const;
