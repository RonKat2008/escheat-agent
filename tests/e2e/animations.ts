import type { Page } from "playwright/test";

/** Upper bound on the wait: the longest finite entrance animation in the app is well under this. */
const SETTLE_CAP_MS = 5_000;

/**
 * Waits for every running finite animation on the page to finish. Infinite loops (Money Flow particles, the running
 * pulse) never finish, so waiting on them hangs until the test times out; they are decorative and skipped here.
 * Paused or idle animations never resolve `finished` either, so only running ones are awaited, and the wait is capped
 * so a stalled animation cannot eat the test's whole timeout.
 */
export async function finishAnimations(page: Page): Promise<void> {
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
