"use client";

import { useEffect, useState, type RefObject } from "react";

/** Continuous in-view flag (true while intersecting, false when scrolled away). */
export function useInViewport<T extends Element>(
  ref: RefObject<T | null>,
  options: { rootMargin?: string; threshold?: number } = {},
): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined"); // no IO: assume visible
  const { rootMargin = "0px", threshold = 0 } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setInView(last.isIntersecting);
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, threshold]);

  return inView;
}
