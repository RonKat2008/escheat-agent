/**
 * Readiness: proven links over links that are due today. A link the law does not require (not_required) and a link that
 * is required but not yet due (not_yet_due) are both left out of the denominator: an auditor examines what should
 * exist today, so a letter whose window opens in 2029 is not a gap. Not-yet-due links are still counted and shown.
 *
 * A "rules gap" (the rule file is on file but its values are UNVERIFIED) is one state-wide action, so it is counted ONCE
 * for the whole scope however many items carry it, as one unproven link; it is never a per-item missing proof.
 */
import type { LinkStatus, ProofLink } from "./proof-chain";

export interface Readiness {
  proven: number;
  /** Links whose record is absent (a person must produce or send something). */
  missing: number;
  /** 1 when the scope has an unverified-rules gap (counted once, inside `required`), else 0. */
  rulesGaps: number;
  notYetDue: number;
  notRequired: number;
  /** Links due today: proven + missing. */
  required: number;
  /** Whole percent, floored so anything short of every link proven reads below 100. null when nothing is required. */
  pct: number | null;
}

const count = (links: readonly ProofLink[], s: LinkStatus) => links.reduce((n, l) => n + (l.status === s ? 1 : 0), 0);

export function readiness(chains: readonly (readonly ProofLink[])[]): Readiness {
  const links = chains.flat();
  const proven = count(links, "proven");
  const rulesGaps = count(links, "rules_gap") > 0 ? 1 : 0;
  const missing = count(links, "missing");
  const notYetDue = count(links, "not_yet_due");
  const notRequired = count(links, "not_required");
  const required = proven + missing + rulesGaps;
  return { proven, missing, rulesGaps, notYetDue, notRequired, required, pct: required === 0 ? null : Math.floor((proven * 100) / required) };
}
