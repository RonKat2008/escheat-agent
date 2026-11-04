"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isNavigationPending, isRouterNavigationClick, markNavigationDone, markNavigationStart, subscribeNavigation } from "./nav-hold";

const serverPending = () => false;

/**
 * Marks client navigations (internal link clicks, back/forward) for the skeleton hold (nav-hold.ts) and draws a 2px
 * electric-blue bar across the top while one is in flight. The bar only fades in after 120ms, so fast navigations never
 * flash it; under reduced motion it is a static bar with no sweep. Uses search params, so render inside Suspense.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const pending = useSyncExternalStore(subscribeNavigation, isNavigationPending, serverPending);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const go = isRouterNavigationClick(
        e,
        { href: anchor.href, target: anchor.target, hasDownload: anchor.hasAttribute("download") },
        { origin: location.origin, pathname: location.pathname, search: location.search },
      );
      if (go) markNavigationStart();
    };
    const onPop = () => markNavigationStart();
    // Capture phase: runs before next/link's own click handler starts the router transition.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // The new URL committed: the navigation is over.
  useEffect(() => {
    markNavigationDone();
  }, [pathname, search]);

  return (
    <div aria-hidden data-testid="nav-progress" data-pending={pending ? "true" : "false"} className="nav-progress">
      <div className="nav-progress-bar" />
    </div>
  );
}
