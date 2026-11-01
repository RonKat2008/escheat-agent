/** Why Approve is disabled, in the order the reviewer can fix it. Null when nothing blocks approval. */
export function approveBlockReason(a: {
  composed: boolean;
  problems: string[];
  needsRecipient: boolean;
  to: string;
  allowlisted: boolean;
  approver: string;
}): string | null {
  if (!a.composed) return "compose the draft first so you can see exactly what will be sent.";
  const [first, ...rest] = a.problems;
  if (first) return `${first.replace(/\.$/, "")}${rest.length > 0 ? ` (+${rest.length} more under Safety checks)` : ""}.`;
  if (a.needsRecipient && a.to.trim().length === 0) return "choose a recipient from the allowlist.";
  if (!a.allowlisted) return "the recipient is not on the test allowlist.";
  if (a.approver.trim().length === 0) return "enter your name in Approver.";
  return null;
}
