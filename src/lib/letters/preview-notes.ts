import { plainLanguage } from "./plain-language";

/** What the stored compose record says (see composeLetter's tracking.compose). */
export interface ComposeRecord {
  readiness?: { ready?: boolean; problems?: string[] };
  requiredLanguageVerified?: boolean;
  variables_source?: string;
  variablesFallbackReason?: string | null;
}

export interface PreviewNotes {
  /** Short, always-visible notes in operator language. */
  notes: string[];
  /** "How this letter was built", in human words. Empty when there is nothing to add. */
  built: string[];
}

/**
 * The operator-visible notes for the in-app preview. Pure. Raw developer text (variables_source, rule TODO, env var
 * names) never appears: problems go through plainLanguage. This never touches the letter itself; statutory wording
 * comes only from the rule files.
 */
export function previewNotes(input: { channel: string; offline: boolean; compose?: ComposeRecord }): PreviewNotes {
  const { compose } = input;
  const notes: string[] = [];
  if (input.offline) notes.push("OFFLINE PREVIEW - nothing was sent");
  if (compose?.readiness?.ready === false) {
    const problems = [...new Set((compose.readiness.problems ?? []).map(plainLanguage).filter(Boolean))];
    notes.push(`NOT READY: ${problems.join(" ") || "this draft can't be approved yet."}`);
  }
  if (input.channel === "letter" && compose?.requiredLanguageVerified === false) notes.push("UNVERIFIED rule text");

  const built: string[] = [];
  if (compose?.variables_source === "model") {
    built.push("The greeting and the item description were written by the AI assistant from this item's details.");
  } else if (compose?.variables_source === "template") {
    built.push("The greeting and the item description come from the standard template, because the AI assistant was not used for this draft.");
  }
  if (input.channel === "letter") built.push("The state notice wording is copied word for word from the rules on file.");
  return { notes, built };
}
