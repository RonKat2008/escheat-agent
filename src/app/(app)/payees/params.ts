import { createLoader, parseAsString } from "nuqs/server";

/** URL state for /payees. Shared by the server loader and the client hooks. */
export const payeesParsers = {
  q: parseAsString,
  state: parseAsString,
  show: parseAsString,
  basis: parseAsString,
  payee: parseAsString,
};

export const loadPayeesParams = createLoader(payeesParsers);

export const SHOW_OPTIONS = [
  { value: "review", label: "Needs review" },
  { value: "aliases", label: "Has aliases" },
  { value: "human", label: "Human-reviewed" },
  { value: "items", label: "Has items" },
] as const;

export const BASIS_OPTIONS = [
  { value: "exact", label: "Exact" },
  { value: "rule", label: "Rule" },
  { value: "model", label: "Model" },
  { value: "human", label: "Human" },
] as const;
