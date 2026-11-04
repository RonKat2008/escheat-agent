/**
 * Readiness: proven links over required links. A link the law does not require for the item (not_required) is left
 * out of the denominator; a link that is required but not yet due still counts as not proven, because an auditor can
 * only be shown what exists today.
 */
import type { LinkStatus, ProofLink } from "./proof-chain";

export interface Readiness {
  proven: number;
  missing: number;
  notYetDue: number;
  notRequired: number;
  /** proven + missing + notYetDue. */
  required: number;
  /** Whole percent, floored so anything short of every link proven reads below 100. null when nothing is required. */
  pct: number | null;
}

const count = (links: readonly ProofLink[], s: LinkStatus) => links.reduce((n, l) => n + (l.status === s ? 1 : 0), 0);

export function readiness(chains: readonly (readonly ProofLink[])[]): Readiness {
  const links = chains.flat();
  const proven = count(links, "proven");
  const missing = count(links, "missing");
  const notYetDue = count(links, "not_yet_due");
  const notRequired = count(links, "not_required");
  const required = proven + missing + notYetDue;
  return { proven, missing, notYetDue, notRequired, required, pct: required === 0 ? null : Math.floor((proven * 100) / required) };
}
