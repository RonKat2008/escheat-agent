import { z } from "zod";

/**
 * R5-10: one approver identity rule for every human gate. The name is typed by the person (never prefilled), at least
 * two characters, and every approval endpoint validates it with this one schema so a blank name is refused everywhere.
 */
export const APPROVER_MIN_CHARS = 2;
export const APPROVER_MAX_CHARS = 80;
export const APPROVER_REQUIRED_MESSAGE = `Enter your name (${APPROVER_MIN_CHARS}+ characters)`;

export const approverNameSchema = z.string().trim().min(APPROVER_MIN_CHARS, APPROVER_REQUIRED_MESSAGE).max(APPROVER_MAX_CHARS);

export const isValidApproverName = (name: string): boolean => approverNameSchema.safeParse(name).success;

/** What approval rows may carry after the typed name: the session the approval came from. Not part of the name. */
const SESSION_SUFFIX = /\s*\((?:local dev, gate disabled|passcode session [0-9a-z]{1,16})\)\s*$/i;

/**
 * R6-10: the approver as people read it, wherever an approval is shown: just the typed name. How the person was
 * signed in is a separate fact (the filing record's `signIn`), never glued onto the name.
 */
export function approverName(stored: string | null | undefined): string | null {
  const name = (stored ?? "").replace(SESSION_SUFFIX, "").trim();
  return name || null;
}
