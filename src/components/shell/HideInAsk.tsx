"use client";

import type { ReactNode } from "react";
import { modeOf } from "./mode";
import { useShellPathname } from "./useShellLocation";

/**
 * Renders its children in Dashboard mode only (docs/ASK-MODE.md §1: Ask has no Loop Bar and no section pill nav).
 * Children stay server components. `fallback` keeps a grid slot occupied so the top bar's columns do not shift.
 * Hydration-safe pathname (useShellLocation.ts), so the server HTML and the first client render agree.
 */
export function HideInAsk({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const pathname = useShellPathname();
  return modeOf(pathname) === "ask" ? fallback : children;
}
