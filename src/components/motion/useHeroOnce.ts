"use client";

import { useEffect, useState } from "react";
import { addSeen, hasSeen } from "./seen";

const STORE_KEY = "es-hero-seen";

/**
 * One hero sequence per page, once per session (§2.2 rule 2). Returns true only on the first client view of `id` this
 * session and only when motion is allowed; on the server, on revisits and under reduced motion it is false, so the
 * page renders its final state. For server-decided first visits use isFirstVisit() from ./first-visit.
 */
export function useHeroOnce(id: string): boolean {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";
    let first = true;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      first = !hasSeen(raw, id);
      if (first) sessionStorage.setItem(STORE_KEY, addSeen(raw, id));
    } catch {
      first = false; // storage blocked: render final rather than replaying every visit
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decided after hydration from session storage
    if (first && !reduced) setPlay(true);
  }, [id]);
  return play;
}
