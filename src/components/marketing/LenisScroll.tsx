"use client";

import { useEffect } from "react";

/** Smooth scroll for the public marketing pages only (never mounted in the app shell). Off under reduced motion; loaded after first paint. */
export function LenisScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let destroy: (() => void) | undefined;
    let cancelled = false;
    const start = () => {
      void import("lenis").then(({ default: Lenis }) => {
        if (cancelled) return;
        const lenis = new Lenis({ lerp: 0.1, autoRaf: true, anchors: true });
        destroy = () => lenis.destroy();
      });
    };
    const timer = window.setTimeout(start, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      destroy?.();
    };
  }, []);
  return null;
}
