/**
 * Resolves once the page has finished loading and the main thread is idle. Code that is not needed for the first paint
 * (the domMax layout features, the toast outlet) waits on this, so it never competes with the initial bundle.
 */
let afterLoad: Promise<void> | null = null;

export function afterLoadIdle(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  afterLoad ??= new Promise<void>((resolve) => {
    const idle = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 2000 });
      else setTimeout(resolve, 200);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
  return afterLoad;
}
