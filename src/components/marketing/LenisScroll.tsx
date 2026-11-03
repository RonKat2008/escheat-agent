"use client";

import { useEffect } from "react";
import { readMotionPref } from "@/components/viz/core/useRenderTier";

const START_DELAY_MS = 800;

/**
 * Smooth scroll for the public marketing pages only (never mounted in the app shell). Off under reduced motion (the OS
 * setting or the in-app preference); loaded after first paint so it never counts toward initial JS.
 */
export function LenisScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || readMotionPref() === "reduce") return;
    let destroy: (() => void) | undefined;
    let cancelled = false;
    const start = () => {
      void import("lenis").then(({ default: Lenis }) => {
        if (cancelled) return;
        const lenis = new Lenis({ lerp: 0.1, autoRaf: true, anchors: true });
        destroy = () => lenis.destroy();
      });
    };
    const timer = window.setTimeout(start, START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      destroy?.();
    };
  }, []);
  return null;
}
