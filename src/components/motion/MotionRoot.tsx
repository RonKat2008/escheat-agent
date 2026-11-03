"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { afterLoadIdle } from "./idle";
import { MOTION_CHANGE_EVENT, readMotionPref } from "@/components/viz/core/useRenderTier";

function subscribe(cb: () => void): () => void {
  window.addEventListener(MOTION_CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(MOTION_CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** True when the in-app "Reduce motion" preference is on (localStorage es-motion=reduce). False on the server. */
export function useUserReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readMotionPref() === "reduce",
    () => false,
  );
}

/**
 * App-wide motion boundary (§2): LazyMotion with the small domAnimation set (strict, so only `m.*` components work)
 * and MotionConfig reducedMotion="user". The in-app Reduce motion preference forces "always" and mirrors itself onto
 * <html data-motion="reduce">, which globals.css uses to stop CSS transitions and animations too.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  const userReduce = useUserReducedMotion();
  useEffect(() => {
    const html = document.documentElement;
    if (userReduce) html.dataset.motion = "reduce";
    else delete html.dataset.motion;
  }, [userReduce]);
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={userReduce ? "always" : "user"}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/**
 * Second LazyMotion boundary that loads domMax (layoutId, drag) on demand. Wrap only the subtree that needs it. The
 * feature bundle (layout projection, ~15 KB gz) is fetched after the page has loaded: the active-tab indicators it
 * animates are already in the server HTML, so nothing here is needed for the first paint.
 */
export function MotionMax({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={() => afterLoadIdle().then(() => import("./dom-max")).then((mod) => mod.default)} strict>
      {children}
    </LazyMotion>
  );
}
