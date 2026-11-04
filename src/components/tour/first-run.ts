/**
 * First-run welcome: whether this browser has already answered "Take the tour" or "Skip". Stored in localStorage
 * under one key; every access is wrapped, so a private window, blocked storage or a throwing accessor just means
 * "ask again next time" (reading) or "remember for this page only" (writing), never an error.
 *
 * E2E specs that are not about the welcome set this key up front (tests/e2e/first-run.ts) so it never covers them.
 */
export const FIRST_RUN_KEY = "es-first-run";

export type FirstRunChoice = "toured" | "skipped";

/** The subset of Storage this module uses (injectable for tests). */
export type FirstRunStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): FirstRunStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // the accessor itself throws when site data is blocked
  }
}

/** The remembered choice, or null when the welcome has never been answered (or storage cannot be read). */
export function readFirstRun(storage: FirstRunStorage | null = defaultStorage()): FirstRunChoice | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(FIRST_RUN_KEY);
    return v === "toured" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
}

/** Remember the choice. Returns false when storage refused it (the welcome then only stays closed for this page). */
export function markFirstRun(choice: FirstRunChoice, storage: FirstRunStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FIRST_RUN_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** Show the welcome only when nothing is remembered and no tour is already open. */
export function shouldWelcome(choice: FirstRunChoice | null, tourOpen: boolean): boolean {
  return choice === null && !tourOpen;
}
