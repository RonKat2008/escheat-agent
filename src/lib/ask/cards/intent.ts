/**
 * Ask action-card intents (docs/ASK-MODE.md §2.1 / §3.2, the no-model half of slice 3). A few setup-shaped requests
 * ("upload a CSV", "set up integrations", "what's overdue", "get started") are mapped by plain regular expressions to a
 * card tool, which renders a card the PERSON completes. No model is involved and nothing here decides law: the matcher
 * only picks which card to show, plus an import kind typed by the user.
 *
 * Order matters: the most specific shapes are tried first, so "help me upload a CSV" is an import, not onboarding.
 * Anything that matches none of these returns null and chat behaves exactly as before.
 *
 * Pure and client-safe (the composer, the starter chips and the follow-up chips use it to decide what Ask can do
 * without a model).
 */
import type { IngestKind } from "@/lib/ingest/schemas";
import { ASK_CARD_TOOL, type AskCardId } from "./registry";

export interface AskCardCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AskCardIntent {
  id: AskCardId;
  calls: AskCardCall[];
}

const normalize = (raw: string): string => raw.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");

/** Upload or import a file, or a CSV named outright. */
const IMPORT_RE = /\b(upload|import|re-?import)\b|\bcsv\b|\bspreadsheet\b|\bcheck register\b/;
/** Bank clears rather than the check register. */
const CLEARS_RE = /\b(bank|clears?|cleared|clearing|statement)\b/;
/** Connect or configure an outside service. */
const INTEGRATIONS_RE =
  /\b(set ?up|setup|connect|configure|hook up|turn on|enable)\b|\bintegrations?\b|\bquickbooks\b|\bqbo\b|\bplaid\b|\binngest\b|\bbrowserbase\b|\bneon\b|\bapi keys?\b|\.env\b|\benv vars?\b/;
/** "Set up outreach" / "set up letters" is a different card (not built yet): keep today's behaviour for it. */
const NOT_INTEGRATIONS_RE = /\b(outreach|letters?|drafts?|close|report|filing|period)\b/;
/** Things waiting on a person. */
const NEEDS_YOU_RE =
  /\boverdue\b|\bpast[\s-]due\b|\bmissed\b|\bneeds? (?:me|my (?:attention|action|input))\b|\bwaiting (?:on|for) me\b|\bwhat should i do\b|\bwhat do i (?:need|have) to do\b|\bmy (?:to-?do|todo)s?\b/;
/** Onboarding and generic help. */
const GETTING_STARTED_RE =
  /\bget(?:ting)? started\b|\bstart here\b|\bonboard(?:ing)?\b|\bhelp\b|\bwhere do i (?:start|begin)\b|\bhow do i (?:start|begin|use this)\b|\bfirst steps?\b|\bwhat can you do\b|\bchecklist\b/;

const call = (id: AskCardId, input: Record<string, unknown> = {}): AskCardIntent => ({ id, calls: [{ name: ASK_CARD_TOOL[id], input }] });

/** Maps one user message to the card that does it, or null to keep today's behaviour. */
export function matchCardIntent(raw: string): AskCardIntent | null {
  const q = normalize(raw);
  if (!q) return null;
  if (IMPORT_RE.test(q)) {
    const kind: IngestKind = CLEARS_RE.test(q) ? "clears" : "ledger";
    return call("import_csv", { kind });
  }
  if (INTEGRATIONS_RE.test(q) && !NOT_INTEGRATIONS_RE.test(q)) return call("integrations");
  if (NEEDS_YOU_RE.test(q)) return call("needs_you");
  if (GETTING_STARTED_RE.test(q)) return call("getting_started");
  return null;
}

/** True when Ask can complete `prompt` with a card and no model. */
export const isCardPrompt = (prompt: string): boolean => matchCardIntent(prompt) !== null;
