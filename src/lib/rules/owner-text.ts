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

/** One deterministic statutory element an owner sentence must carry, derived from the rule's statute text. */
export interface OwnerElement {
  id: "holding" | "property" | "holder" | "agency" | "deadline" | "claim";
  /** Checklist label shown beside the textarea. */
  label: string;
  /** What the sentence must contain, in plain words (shown when it is missing). */
  hint: string;
  present: boolean;
  /** The element is mentioned but negated ("we are not holding..."), which is not the same as left out. */
  negated?: boolean;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_DAY = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
const AGENCY_IN_STATUTE = /\b(comptroller|state treasurer|treasurer|controller|department of [a-z]+(?: [a-z]+){0,3})\b/i;

/** The month and day a statute names ("July 1"), or null when it names none. Pure string parsing, no judgment. */
export function statuteDeadline(statute: string): { month: number; day: number } | null {
  const m = MONTH_DAY.exec(statute);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase()) + 1;
  return { month, day: Number(m[2]) };
}

const NEGATOR = /^(?:not|never|no|nothing|cannot|without)$/i;
const CONDITIONAL = /\b(?:if|unless|until|when|whether)\b/i;
const NEGATION_WINDOW = 8;

/**
 * R6-14: true when `re` matches somewhere that is not negated. A match is negated when a negator ("not", "never", "no",
 * "don't", "won't"...) sits within NEGATION_WINDOW words before it in the same clause. A clause opened by a condition
 * ("If it is not claimed", "unless you do not reply") is skipped: that is how the statute itself phrases the duty.
 * Deterministic string checks only; the model decides nothing here.
 */
export function hasUnnegated(text: string, re: RegExp): boolean {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  for (const clause of text.split(/[,;:!?()—]+|\.(?:\s+(?=[A-Z])|\s*$)/)) {
    const conditional = CONDITIONAL.test(clause);
    for (const m of clause.matchAll(new RegExp(re.source, flags))) {
      const before = clause.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-NEGATION_WINDOW);
      const negated = !conditional && before.some((w) => NEGATOR.test(w.replace(/[^\w']/g, "")) || /n['’]t$/i.test(w));
      if (!negated) return true;
    }
  }
  return false;
}

const HOLDING_RE = /\bhold(?:s|ing)?\b/i;
const PROPERTY_RE = /\bproperty\b|\b(?:check|payment|funds|refund|deposit|balance)\b|\$\s?\d/i;
const CLAIM_RE = /\bclaim(?:ed|s|ing)?\b|\bcontact\b|\brespond|\breply\b|\bcall\b|\bwrite to\b/i;
const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function deadlineRe(d: { month: number; day: number }): RegExp {
  const name = MONTHS[d.month - 1]!;
  const short = name.slice(0, 3);
  const ord = `${d.day}(?:st|nd|rd|th)?\\b`;
  return new RegExp(`\\b(?:${name}|${short}\\.?)\\s+${ord}|\\b${ord}\\s+(?:of\\s+)?(?:${name}|${short}\\b)|\\b0?${d.month}/0?${d.day}\\b`, "i");
}

function mentionsDeadline(text: string, d: { month: number; day: number }): boolean {
  return hasUnnegated(text, deadlineRe(d));
}

/**
 * The statutory elements an owner sentence must carry, derived from the statute text the rule cites (never from a
 * model). For TX ("the holder is holding the property; ... deliver the property to the comptroller on or before July 1
 * if the property is not claimed") that is: who holds it (the holder, named or "we"), that it is holding the property
 * and what it is, the agency it may go to, the deadline, and how the owner can claim or respond.
 */
export function requiredOwnerElements(statute: string, ownerText: string, holderName?: string | null): OwnerElement[] {
  const t = ownerText;
  const out: OwnerElement[] = [];
  const add = (e: Omit<OwnerElement, "present" | "negated">, present: boolean, re?: RegExp) =>
    out.push({ ...e, present, ...(re && !present && re.test(t) ? { negated: true } : {}) });
  if (/\bhold(?:ing|s)?\b/i.test(statute)) {
    const named = holderName ? t.toLowerCase().includes(holderName.trim().toLowerCase()) : false;
    add({ id: "holder", label: 'Who is holding it (the holder\'s name, or "we")', hint: 'Name the holder or say "we"' }, named || /\b(we|our|us)\b/i.test(t));
    add({ id: "holding", label: "That the holder is holding the property", hint: 'Say the property is being held, for example "is holding"' }, hasUnnegated(t, HOLDING_RE), HOLDING_RE);
    add({ id: "property", label: "What the property is (amount or description)", hint: "Say what it is: property, a check, a payment, or an amount" }, hasUnnegated(t, PROPERTY_RE), PROPERTY_RE);
  }
  const agency = AGENCY_IN_STATUTE.exec(statute)?.[1];
  const agencyRe = new RegExp(escapeRe(agency ?? ""), "i");
  if (agency) add({ id: "agency", label: `Who it may be delivered to (the ${agency})`, hint: `Mention the ${agency}` }, hasUnnegated(t, agencyRe), agencyRe);
  const deadline = statuteDeadline(statute);
  if (deadline) {
    const label = `${MONTHS[deadline.month - 1]} ${deadline.day}`;
    add({ id: "deadline", label: `The deadline (${label})`, hint: `Mention ${label}` }, mentionsDeadline(t, deadline), deadlineRe(deadline));
  }
  if (/\bclaim(?:ed|s)?\b/i.test(statute) || deadline) {
    add({ id: "claim", label: "How the owner can claim or respond", hint: "Say the owner can claim it, contact you, or reply" }, hasUnnegated(t, CLAIM_RE), CLAIM_RE);
  }
  return out;
}

/** Why an owner-facing sentence cannot be approved, or null when it can. Pass the statute text to also check content. */
export function ownerTextProblem(text: string, statute?: string | null, holderName?: string | null): string | null {
  const t = text.trim();
  if (t.length === 0) return "Write the sentence owners will read in the letter.";
  if (t.length < OWNER_TEXT_MIN_CHARS) return `Write a full sentence (${OWNER_TEXT_MIN_CHARS} or more characters).`;
  if (t.length > OWNER_TEXT_MAX_CHARS) return `Keep it under ${OWNER_TEXT_MAX_CHARS} characters.`;
  if (addressedToHolderText(t)) return 'This is addressed to the holder. Write it to the owner, for example "We are holding property for you…".';
  if (UNFILLED_SLOT.test(t)) return "Fill in or remove the [bracketed] placeholder.";
  if (statute) {
    const elements = requiredOwnerElements(statute, t, holderName);
    const missing = elements.filter((e) => !e.present);
    const negated = elements.filter((e) => e.negated);
    if (negated.length > 0) {
      return `This sentence denies what the statute requires it to say (${negated.map((e) => e.label).join("; ")}). Rewrite it to state the notice plainly, without "not", "never" or "do not" before those points.`;
    }
    if (missing.length > 0) return `The statute requires more: ${missing.map((e) => e.hint).join("; ")}.`;
  }
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
