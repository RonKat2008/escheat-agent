import { UnverifiedBadge } from "@/components/primitives";
import type { SafetyCheck } from "./SafetyChecks";
import type { OutreachView, QueueData } from "./queue-data";

/** The recipient check for email and calls. Plain language only (R3-14): no env var names. */
function recipientCheck(o: OutreachView, to: string, allowlisted: boolean, allowCount: number): SafetyCheck {
  const what = o.channel === "email" ? "email addresses" : "phone numbers";
  if (to.trim().length === 0) {
    return {
      id: "recipient",
      level: "note",
      body: allowCount === 0 ? `No test ${what} are set up for this demo yet, so nothing can be sent.` : `Enter a recipient from the test allowlist (${allowCount} ${allowCount === 1 ? "entry" : "entries"}).`,
    };
  }
  return allowlisted
    ? { id: "recipient", level: "pass", body: "Recipient is on the test allowlist." }
    : { id: "recipient", level: "block", body: "Recipient is not on the test allowlist. The server will refuse to send." };
}

function languageCheck(o: OutreachView): SafetyCheck {
  const checked = o.composed && o.requiredLanguageVerified !== null;
  if (!checked) return { id: "language", level: "note", body: "Not checked yet. Compose the letter to check the required state notice wording." };
  if (o.requiredLanguageVerified === true) {
    return { id: "language", level: o.readiness.problems.length ? "note" : "pass", body: "Required state notice wording is verified." };
  }
  return {
    id: "language",
    level: "note",
    body: (
      <>
        Required state notice wording has not been checked by a person yet <UnverifiedBadge className="ml-1 align-middle" />
      </>
    ),
  };
}

/** Every check shown under "Safety checks" for one draft, in display-ready language. */
export function outreachChecks(o: OutreachView, env: QueueData["env"], to: string, allowlisted: boolean, allowCount: number): SafetyCheck[] {
  const channelCheck: SafetyCheck =
    o.channel === "letter"
      ? {
          id: "lob",
          level: env.lobConfigured ? "pass" : "note",
          body: env.lobConfigured
            ? "Lob test mode. No physical mail is produced."
            : "You can approve now. The mail service's test connection isn't set up yet (Settings › Integrations), so Send will only show a preview.",
        }
      : recipientCheck(o, to, allowlisted, allowCount);
  return [
    { id: "synthetic", level: "pass", body: "Synthetic data only. No real people or accounts." },
    channelCheck,
    ...(o.channel === "letter" ? [languageCheck(o)] : []),
    ...o.readiness.problems.map((p): SafetyCheck => ({ id: `p:${p}`, level: "block", body: p })),
    ...o.readiness.warnings.map((w): SafetyCheck => ({ id: `w:${w}`, level: "note", body: w })),
    ...(o.dependsOnUnverified
      ? [
          {
            id: "unverified",
            level: "note" as const,
            body: (
              <>
                Dates for this item depend on rule values a person has not checked yet <UnverifiedBadge className="ml-1 align-middle" />
              </>
            ),
          },
        ]
      : []),
  ];
}

/** Is `to` on the allowlist? Emails compare case-insensitively; phone numbers compare by digits. */
export function isAllowlisted(channel: OutreachView["channel"], to: string, allow: string[]): boolean {
  if (channel === "letter") return true;
  const t = to.trim();
  if (!t) return false;
  if (channel === "email") return allow.some((a) => a.toLowerCase() === t.toLowerCase());
  const digits = (v: string) => v.replace(/\D/g, "");
  return digits(t).length >= 8 && allow.some((a) => digits(a) === digits(t));
}
