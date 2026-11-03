import type { RuleValue } from "../../../rules/schema";

/**
 * R4-01: the statute says what a notice must convey (the verbatim requirement, kept on the rule as `value`); the owner
 * letter needs a sentence written TO the owner. A human writes and approves that sentence (`owner_text`). Nothing here
 * invents wording: there is no deterministic statute-to-owner transform, so the sentence starts empty and is required.
 * Pure (no DB, no React) so the client dialog, the server gate and the letter composer share one set of checks.
 */

/** The rule paths whose value is printed in owner letters, so they need an owner-facing sentence. */
export const OWNER_FACING_PATHS: readonly string[] = ["dueDiligence.requiredLanguage"];

export const OWNER_TEXT_MIN_CHARS = 20;
export const OWNER_TEXT_MAX_CHARS = 2_000;

export const needsOwnerText = (path: string): boolean => OWNER_FACING_PATHS.includes(path);

/** Text written to the holder ("You (the holder) are holding…") rather than to the owner who reads the letter. */
export function addressedToHolderText(text: string): boolean {
  return /\(the holder\)/i.test(text) || /\byou\b[^.;]{0,30}\bthe holder\b/i.test(text);
}

/** Bracketed slots other than the date slot the composer fills ("[insert date …]"). */
const UNFILLED_SLOT = /\[(?!insert date)[^\]]*\]/i;

/** Why an owner-facing sentence cannot be approved, or null when it can. */
export function ownerTextProblem(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return "Write the sentence owners will read in the letter.";
  if (t.length < OWNER_TEXT_MIN_CHARS) return `Write a full sentence (${OWNER_TEXT_MIN_CHARS} or more characters).`;
  if (t.length > OWNER_TEXT_MAX_CHARS) return `Keep it under ${OWNER_TEXT_MAX_CHARS} characters.`;
  if (addressedToHolderText(t)) return "This is addressed to the holder. Write it to the owner, for example \"We are holding property for you…\".";
  if (UNFILLED_SLOT.test(t)) return "Fill in or remove the [bracketed] placeholder.";
  return null;
}

export interface OwnerFacingLanguage {
  /** The words the letter prints, or null when there are none it may print. */
  text: string | null;
  /** owner_text: a human-approved owner sentence; value: the rule value itself (already owner-facing). */
  from: "owner_text" | "value" | null;
  /** Set when a value exists but cannot be printed (it is addressed to the holder and has no owner sentence). */
  problem: string | null;
}

/**
 * Which notice words an owner letter prints for a rule value: the approved owner-facing sentence when there is one,
 * else the value itself when it already speaks to the owner (CA, DE). Holder-addressed statute text is never printed.
 */
export function ownerFacingLanguage(rv: Pick<RuleValue<string>, "value" | "owner_text">): OwnerFacingLanguage {
  const owner = rv.owner_text?.trim();
  if (owner) return { text: owner, from: "owner_text", problem: null };
  if (rv.value === null) return { text: null, from: null, problem: null };
  if (addressedToHolderText(rv.value)) {
    return { text: null, from: null, problem: "the required notice language is addressed to the holder and has no approved owner-facing sentence" };
  }
  return { text: rv.value, from: "value", problem: null };
}
