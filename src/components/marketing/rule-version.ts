/**
 * Human label for a rule-file version string. Shapes seen in rules/*.json and rules/history:
 *   "2026.10.1"                              -> "rules v2026.10.1"
 *   "2026.10.1-draft"                        -> "rules v2026.10.1 · draft"
 *   "2026.10.1-draft+appr.20261103T200207"   -> "rules v2026.10.1 · draft · approved Nov 3"
 * An approval replaces the previous `+appr.` suffix (see lib/rules/apply.ts), so approvals are never counted here.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VERSION_RE = /^([^-+]+)(?:-([^+]+))?(?:\+appr\.(\d{8})T\d{6})?$/;

function approvedOn(stamp: string): string | null {
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

export function ruleVersionLabel(version: string): string {
  const m = VERSION_RE.exec(version.trim());
  if (!m) return `rules v${version}`;
  const [, base, tag, stamp] = m;
  const parts = [`rules v${base}`];
  if (tag) parts.push(tag);
  if (stamp) {
    const day = approvedOn(stamp);
    parts.push(day ? `approved ${day}` : "approved");
  }
  return parts.join(" · ");
}
