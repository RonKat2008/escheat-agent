import { createLoader, parseAsNumberLiteral, parseAsStringLiteral } from "nuqs/server";
import { DEFAULT_HORIZON_MONTHS, HORIZON_OPTIONS } from "@/lib/forecast/compute";

/** States with a rule file in this prototype (rules/*.json). */
export const FORECAST_STATES = ["CA", "DE", "TX"] as const;
/** Chart basis: amounts by the month items become presumed abandoned, or by the month they must be remitted. */
export const BASIS_VALUES = ["presumed", "remit"] as const;
export type Basis = (typeof BASIS_VALUES)[number];

/** URL state for /forecast. Shared by the server loader and the client filter bar. */
export const forecastParsers = {
  state: parseAsStringLiteral(FORECAST_STATES),
  horizon: parseAsNumberLiteral(HORIZON_OPTIONS).withDefault(DEFAULT_HORIZON_MONTHS as (typeof HORIZON_OPTIONS)[number]),
  basis: parseAsStringLiteral(BASIS_VALUES).withDefault("presumed"),
};

export const loadForecastParams = createLoader(forecastParsers);
