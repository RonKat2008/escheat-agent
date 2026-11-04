const STATE_RE = /^(ca|de|tx)$/i;
const CONFIRMATION_RE = /^REPL-(CA|DE|TX)-\d{4}-[A-Z0-9]{6}$/;

/**
 * Where a filing shows up on the replica state's side: the holder portal dashboard, which lists "Filed reports" and
 * highlights this confirmation. Null when the state is not one of the three replicas or the number is not a replica
 * confirmation (so a caller never links to a real or malformed target). Replica only: never a real state site.
 * The close-out receipt should link its confirmation number here.
 */
export function replicaFilingUrl(state: string, confirmation: string): string | null {
  if (!STATE_RE.test(state) || !CONFIRMATION_RE.test(confirmation)) return null;
  const st = state.toLowerCase();
  if (confirmation.split("-")[1]!.toLowerCase() !== st) return null;
  return `/replica/${st}-holder/dashboard?filed=${encodeURIComponent(confirmation)}#filed-reports`;
}

const CLAIM_RE = /^REPL-CLM-(CA|DE|TX)-\d{4}-[A-Z0-9]{6}$/;

/** Where a filed claim shows up on the replica search portal: its "Filed claims" list, highlighting this confirmation. */
export function replicaClaimUrl(state: string, confirmation: string): string | null {
  if (!STATE_RE.test(state) || !CLAIM_RE.test(confirmation)) return null;
  const st = state.toLowerCase();
  if (confirmation.split("-")[2]!.toLowerCase() !== st) return null;
  return `/replica/${st}-search/claims?filed=${encodeURIComponent(confirmation)}`;
}
