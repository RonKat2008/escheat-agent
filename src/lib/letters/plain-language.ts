/**
 * R3-14: the finance reviewer never sees developer or config text (env var names, "rule TODO", raw codes). Readiness
 * problems and warnings come from the composer in engineer wording; this maps each known message to plain language and
 * scrubs anything config-shaped from the rest. Pure, so it is unit tested.
 */

import { toOperatorMessage } from "@/lib/settings/operator-copy";

const KNOWN: { re: RegExp; to: (m: RegExpMatchArray) => string }[] = [
  {
    re: /OWNER_LINK_SECRET is not set/i,
    to: () => "The owner's reply link uses a temporary demo key, so it stops working if the app restarts.",
  },
  { re: /APP_BASE_URL is not set/i, to: () => "The owner's reply link points at the address this app is running on." },
  {
    re: /required notice language for ([A-Z]{2}) is UNKNOWN/i,
    to: (m) => `The ${m[1]!.toUpperCase()} notice wording has not been confirmed yet, so this letter can't be approved.`,
  },
  {
    re: /required notice language for ([A-Z]{2}) is addressed to the holder/i,
    to: (m) => `The ${m[1]!.toUpperCase()} notice wording is written to the holder, so it needs an owner-facing sentence approved on the Rules page.`,
  },
  {
    re: /required state notice language is UNKNOWN/i,
    to: () => "The state's notice wording has not been confirmed yet, so this letter can't be approved.",
  },
  {
    re: /([A-Z]{2}) required-language rule value is UNVERIFIED/i,
    to: (m) => `The ${m[1]!.toUpperCase()} notice wording has not been checked by a person yet.`,
  },
  { re: /owner response link unavailable/i, to: () => "The owner's reply link could not be created for this draft." },
  { re: /no composed body|not composed yet/i, to: () => "This draft has not been composed yet." },
  { re: /no rule file for ([A-Z]{2})/i, to: (m) => `There are no rules on file for ${m[1]!.toUpperCase()} yet.` },
  {
    re: /owner state is unknown/i,
    to: () => "We don't know which state the owner is in, so the right notice wording can't be chosen.",
  },
  { re: /owner mailing address is missing or incomplete/i, to: () => "The owner's mailing address is missing or incomplete." },
  { re: /holder return address is missing or incomplete/i, to: () => "Your company's return address is missing or incomplete." },
  {
    re: /amount is below ([A-Z]{2})'s due-diligence minimum \(([^)]+)\)/i,
    to: (m) => `The amount is below ${m[1]!.toUpperCase()}'s due-diligence minimum (${m[2]}), so a letter may not be required.`,
  },
  // Allowlist settings: one shared wording from operator-copy, never an env var name.
  { re: /ALLOWED_TEST_(?:RECIPIENTS|PHONES)/, to: (m) => toOperatorMessage(m.input ?? "").plain },
  {
    re: /another open letter to this owner in ([A-Z]{2}) must be combined/i,
    to: (m) => `This owner has another open letter in ${m[1]!.toUpperCase()}. Compose all combines them into one notice.`,
  },
  {
    re: /this owner's notice must list every open item in ([A-Z]{2})/i,
    to: (m) => `This owner's notice doesn't list every open ${m[1]!.toUpperCase()} item yet. Compose all adds them.`,
  },
  { re: /changed after you opened it/i, to: () => "This draft changed after you opened it. Reload and review it again." },
];

/** SCREAMING_SNAKE config names, "(rule TODO)", "variables_source: x" and similar developer residue. */
const RESIDUE = [/\(?\brule TODO\b\)?/gi, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, /\bvariables_source:\s*\S+/gi];

function sentence(s: string): string {
  const t = s.replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/[;,]\s*$/, "").trim();
  if (!t) return t;
  const cap = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/** One message in plain language. */
export function plainLanguage(message: string): string {
  for (const k of KNOWN) {
    const m = message.match(k.re);
    if (m) return k.to(m);
  }
  let out = message;
  for (const re of RESIDUE) out = out.replace(re, "");
  return sentence(out);
}

/**
 * A server blockedReason ("Blocked: a; b") in plain language, one sentence per part, keeping the "Blocked:" lead so it
 * reads the same as the pre-checked reasons.
 */
export function plainBlockedReason(reason: string): string {
  const body = reason.replace(/^Blocked:\s*/i, "");
  const parts = body
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const text = [...new Set(parts.map(plainLanguage))].join(" ");
  return `Blocked: ${text || "this draft can't be approved yet."}`;
}
