import { ruleVersionLabel } from "@/lib/rules/version-label";

/** A rule-file version as a short human label; the full version string is in the tooltip (and a machine attribute). */
export function RuleVersion({ version, state, className }: { version: string; state?: string | null; className?: string }) {
  return (
    <span className={className} title={version} data-rule-version={version}>
      {ruleVersionLabel(version, state)}
    </span>
  );
}
