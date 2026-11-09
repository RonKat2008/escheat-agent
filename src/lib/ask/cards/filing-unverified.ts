/**
 * R11-08: a filing card shows UNVERIFIED whenever the state's rule file has an unverified value, or the cycle relies
 * on one, however many items there are to report. The badge follows the rule file, not the item count.
 */
export function showsUnverified(p: { unverifiedRules: number; ruleFileUnverified: number }): boolean {
  return p.unverifiedRules > 0 || p.ruleFileUnverified > 0;
}
