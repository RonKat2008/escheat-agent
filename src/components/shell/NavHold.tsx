"use client";

import { use, type ReactNode } from "react";
import { navigationHold } from "./nav-hold";

/**
 * Wrap a page skeleton (a Suspense fallback or a loading.tsx body) in this. During a client navigation it suspends for
 * the rest of the hold window, so the router's transition keeps the current page up instead of committing the skeleton;
 * if the page's data lands inside the window, the page appears once, complete (see nav-hold.ts). Outside a navigation
 * (server render, hydration, hard load) it renders the skeleton immediately.
 */
export function NavHold({ children }: { children: ReactNode }) {
  const hold = typeof window === "undefined" ? null : navigationHold();
  if (hold) use(hold);
  return children;
}
