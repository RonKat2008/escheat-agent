/**
 * The first-run welcome sheet (src/components/tour/WelcomeSheet.tsx) shows on a browser's first visit. Specs that are
 * not about it start with the answer already remembered, so it never covers what they test:
 *  - playwright.config.ts puts `firstRunSeen(origin)` in every dev project's storageState;
 *  - global-setup.ts writes the same key before saving the ui project's signed-in state;
 *  - a spec that builds its own context uses `withFirstRunSeen(state, origin)`.
 * ui-first-run-tour.spec.ts strips it (`withoutFirstRun`) to see the welcome as a new user would.
 */
import { FIRST_RUN_KEY } from "../../src/components/tour/first-run";

export { FIRST_RUN_KEY };

interface OriginState {
  origin: string;
  localStorage: { name: string; value: string }[];
}
interface StorageStateLike {
  cookies: unknown[];
  origins: OriginState[];
}

/** One origin's localStorage with the welcome already answered ("skipped"). */
export function firstRunSeen(origin: string): OriginState {
  return { origin, localStorage: [{ name: FIRST_RUN_KEY, value: "skipped" }] };
}

/** The same storage state with the welcome answered for `origin` (other keys and origins kept). */
export function withFirstRunSeen<T extends StorageStateLike>(state: T, origin: string): T {
  const o = new URL(origin).origin;
  const found = state.origins.some((x) => x.origin === o);
  const origins = found
    ? state.origins.map((x) => (x.origin === o ? { ...x, localStorage: [...x.localStorage.filter((e) => e.name !== FIRST_RUN_KEY), ...firstRunSeen(o).localStorage] } : x))
    : [...state.origins, firstRunSeen(o)];
  return { ...state, origins };
}

/** The same storage state as a brand-new browser would have for the welcome (cookies, so the session, kept). */
export function withoutFirstRun<T extends StorageStateLike>(state: T): T {
  return { ...state, origins: state.origins.map((x) => ({ ...x, localStorage: x.localStorage.filter((e) => e.name !== FIRST_RUN_KEY) })) };
}
