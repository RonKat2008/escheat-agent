"use client";

import { useMemo, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pickShellLocation, type ShellLocation } from "./hydration-location";

/**
 * The URL the server rendered this document for: the navigation timing entry's URL, which client-side navigations
 * (pushState) never change, so it is right even if this module first loads after one started. Falls back to
 * window.location (captured at module evaluation). Null on the server.
 */
function readDocumentLocation(): ShellLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav?.name) {
      const url = new URL(nav.name);
      if (url.origin === window.location.origin) return { pathname: url.pathname, search: url.search };
    }
  } catch {
    /* no navigation timing: fall through */
  }
  return { pathname: window.location.pathname, search: window.location.search };
}

const DOCUMENT_LOCATION = readDocumentLocation();

const noopSubscribe = () => () => {};

/**
 * True on the server and while React hydrates this component (useSyncExternalStore renders the server snapshot during
 * hydration), false for every client render after that, including components first mounted on the client.
 */
function useHydrating(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
}

/**
 * usePathname() for shell chrome (side nav, breadcrumb), except during hydration, where it returns the document's own
 * pathname so the markup always matches the server HTML even if a navigation began before this boundary hydrated (see
 * hydration-location.ts). React re-renders with the live pathname right after hydration. No search params, so it
 * stays prerenderable in the static shell.
 */
export function useShellPathname(): string {
  const pathname = usePathname();
  const hydrating = useHydrating();
  return pickShellLocation(hydrating, DOCUMENT_LOCATION, { pathname, search: "" }).pathname;
}

/** useShellPathname() plus the search params, with the same hydration rule (the Loop Bar reads `view` and `filter`). */
export function useShellLocation(): { pathname: string; params: URLSearchParams } {
  const pathname = usePathname();
  const live = useSearchParams();
  const hydrating = useHydrating();
  const picked = pickShellLocation(hydrating, DOCUMENT_LOCATION, { pathname, search: live.toString() });
  const params = useMemo(() => new URLSearchParams(picked.search), [picked.search]);
  return { pathname: picked.pathname, params };
}
