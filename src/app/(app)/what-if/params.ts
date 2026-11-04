import { parseAsArrayOf, parseAsInteger, parseAsString } from "nuqs";

/**
 * URL state for /what-if, so a scenario is shareable. `d` = days forward (clamped 0..730 by normalizeScenario),
 * `paid` = items whose owner responds and is paid, `next` = items remitted with the next report, `file` = states filed
 * and remitted on their due dates. Unknown ids and states are dropped, never guessed.
 */
export const whatIfParsers = {
  d: parseAsInteger.withDefault(0),
  paid: parseAsArrayOf(parseAsString).withDefault([]),
  next: parseAsArrayOf(parseAsString).withDefault([]),
  file: parseAsArrayOf(parseAsString).withDefault([]),
};
