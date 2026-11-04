import type { Page } from "playwright/test";

/** Upper bound on the wait: the longest finite entrance animation in the app is well under this. */
const SETTLE_CAP_MS = 5_000;
/** Upper bound on waiting for the Money Flow to lay out its cards after hydration (slow CI dev compiles). */
const FLOW_LAYOUT_CAP_MS = 30_000;

/**
 * The desktop Money Flow measures its own width after hydration and only then mounts its cards, each with a
 * fade-in reveal on the session's first visit (opacity 0 during the delay). On a slow CI runner that happens after
 * the disclaimer is visible and after networkidle, so collecting animations before it misses the reveal and axe
 * samples half-faded text (a false color-contrast failure). Wait until every flow root has its cards; a page without
 * a flow returns at once, and a flow that never lays out is left to the test's own assertions.
 */
export async function waitForFlowLayout(page: Page): Promise<void> {
  await page
    // Only roots that are displayed: phones hide the desktop canvas (display: none, width 0), which never lays out.
    .waitForFunction(() => [...document.querySelectorAll("[data-flow-root]")].filter((r) => r.getClientRects().length > 0).every((r) => r.querySelector("[data-flow-node]")), undefined, {
      timeout: FLOW_LAYOUT_CAP_MS,
    })
    .catch(() => undefined);
}

/**
 * Waits for every running finite animation on the page to finish. Infinite loops (Money Flow particles, the running
 * pulse) never finish, so waiting on them hangs until the test times out; they are decorative and skipped here.
 * Paused or idle animations never resolve `finished` either, so only running ones are awaited, and the wait is capped
 * so a stalled animation cannot eat the test's whole timeout.
 */
export async function finishAnimations(page: Page): Promise<void> {
  await waitForFlowLayout(page);
  await page.evaluate(
    (cap) =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((resolve) => setTimeout(resolve, cap)),
      ]),
    SETTLE_CAP_MS,
  );
}
