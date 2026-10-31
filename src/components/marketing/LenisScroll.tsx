"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Smooth scroll for the public marketing pages only (never mounted in the app shell). Off under reduced motion. */
export function LenisScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.1, autoRaf: true, anchors: true });
    return () => lenis.destroy();
  }, []);
  return null;
}
