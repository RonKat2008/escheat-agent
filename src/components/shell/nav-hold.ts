/**
 * Navigation hold (docs/perf/2026-11-04-navigation.md).
 *
 * React throttles Suspense reveals: once a fallback commits, the content behind it cannot commit for 300 ms. Every page
 * here streams its data behind a skeleton, so before this a client navigation showed the skeleton at ~30 ms and the
 * content never earlier than ~330 ms, even when the server answered in 60 ms.
 *
 * During a navigation, page skeletons are wrapped in <NavHold> (a Suspense fallback that itself suspends for up to
 * NAV_HOLD_MS). Inside the router's transition that keeps the current page on screen, so a page whose data arrives
 * within the window commits once, complete, with no skeleton and no throttle. A slower page shows its skeleton when
 * the window ends, exactly as before. Hard loads and hydration never hold (the skeleton is the server HTML).
 *
 * The same store drives the top progress bar (NavProgress) between a click and the new URL committing.
 */

/** Longest the current page stays up waiting for the next one before its skeleton shows. */
export const NAV_HOLD_MS = 450;
/** A navigation that never commits (aborted, same URL, error page) stops the progress bar after this. */
export const NAV_PENDING_MAX_MS = 10_000;

interface NavState {
  startedAt: number;
  pending: boolean;
}

let state: NavState = { startedAt: Number.NEGATIVE_INFINITY, pending: false };
let hold: { startedAt: number; promise: Promise<void> } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const clock = () => (typeof performance === "undefined" ? Date.now() : performance.now());

export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isNavigationPending(): boolean {
  return state.pending;
}

/** A client navigation is starting now (internal link click, router.push, back/forward). */
export function markNavigationStart(now: number = clock()): void {
  state = { startedAt: now, pending: true };
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(markNavigationDone, NAV_PENDING_MAX_MS);
  emit();
}

/**
 * The new URL committed (or the navigation was abandoned). Ends the hold too: a skeleton that mounts after the commit
 * (a nested boundary, a drawer) renders at once instead of suspending outside the router's transition.
 */
export function markNavigationDone(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!state.pending) return;
  state = { startedAt: Number.NEGATIVE_INFINITY, pending: false };
  emit();
}

/**
 * The promise a skeleton should suspend on right now, or null to render it. One promise per navigation, so React sees
 * the same thenable on every retry and the hold ends exactly NAV_HOLD_MS after the navigation started.
 */
export function navigationHold(now: number = clock()): Promise<void> | null {
  const remaining = state.startedAt + NAV_HOLD_MS - now;
  if (remaining <= 0) return null;
  if (!hold || hold.startedAt !== state.startedAt) {
    hold = { startedAt: state.startedAt, promise: new Promise((resolve) => setTimeout(resolve, remaining)) };
  }
  return hold.promise;
}

/** Call right before a programmatic router.push(href) (palette, shortcuts) so it gets the same hold and progress bar. */
export function markNavigationTo(href: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  markNavigationStart();
}

/** Test-only reset. */
export function resetNavigationState(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  state = { startedAt: Number.NEGATIVE_INFINITY, pending: false };
  hold = null;
  listeners.clear();
}

/** Same-document app navigation that the router will handle: left click, no modifiers, same origin, new URL. */
export function isRouterNavigationClick(
  e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  anchor: { href: string; target: string; hasDownload: boolean },
  current: { origin: string; pathname: string; search: string },
): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (anchor.hasDownload || (anchor.target && anchor.target !== "_self")) return false;
  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}
