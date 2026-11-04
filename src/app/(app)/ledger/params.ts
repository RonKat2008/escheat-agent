import { createLoader, createParser, parseAsStringLiteral } from "nuqs/server";
import { DEFAULT_PERIOD, PERIOD_IDS } from "@/lib/ledger/rollforward";

/** A two-letter owner state; anything else is ignored (the waterfall shows the total). */
const parseAsStateCode = createParser({
  parse: (v) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null),
  serialize: (v) => v,
});

/** URL state for /ledger: the period chip (server-rendered) and the waterfall's state (client only). */
export const ledgerParsers = {
  period: parseAsStringLiteral(PERIOD_IDS).withDefault(DEFAULT_PERIOD),
  state: parseAsStateCode,
};

export const loadLedgerParams = createLoader(ledgerParsers);
