"use client";

import type { ReactNode } from "react";
import { useShellPathname } from "./useShellLocation";

/**
 * Pages whose hero is the first thing under the top bar (V4). There the shell does not draw the Core loop strip under
 * the top bar; the page renders its own copy below the hero (`<LoopBar placement="page" />`).
 */
const HERO_PAGES: ReadonlySet<string> = new Set(["/dashboard"]);

export function isHeroPage(pathname: string): boolean {
  return HERO_PAGES.has(pathname);
}

/** Renders nothing on a hero page (the shell's loading strip would sit above the hero, then vanish: a layout shift). */
export function HideOnHeroPage({ children }: { children: ReactNode }) {
  const pathname = useShellPathname();
  return isHeroPage(pathname) ? null : <>{children}</>;
}
