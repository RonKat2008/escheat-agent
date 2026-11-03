"use client";

import { useSyncExternalStore } from "react";
import {
  computeRenderTier,
  FPS_EVENT,
  FPS_FLAG_KEY,
  MOTION_EVENT,
  MOTION_KEY,
  minTier,
  type MotionPref,
  type RenderTier,
} from "./render-tier";

export { MOTION_KEY, MOTION_EVENT } from "./render-tier";
export { MOTION_EVENT as MOTION_CHANGE_EVENT } from "./render-tier";
export type { MotionPref } from "./render-tier";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

let lowFpsReported = false;
/** Session-sticky floor: once the tier drops it never goes back up. */
let stickyTier: RenderTier = "full";

export function readMotionPref(): MotionPref {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(MOTION_KEY);
    return v === "reduce" || v === "on" ? v : "system";
  } catch {
    return "system";
  }
}

export function setMotionPref(v: MotionPref): void {
  if (typeof window === "undefined") return;
  try {
    if (v === "system") window.localStorage.removeItem(MOTION_KEY);
    else window.localStorage.setItem(MOTION_KEY, v);
  } catch {
    /* storage unavailable: still notify listeners */
  }
  window.dispatchEvent(new Event(MOTION_EVENT));
}

function readLowFps(): boolean {
  if (lowFpsReported) return true;
  try {
    if (window.sessionStorage.getItem(FPS_FLAG_KEY) === "1") lowFpsReported = true;
  } catch {
    /* ignore */
  }
  return lowFpsReported;
}

/** Called by an animated surface whose FPS probe averaged under 50fps. */
export function reportLowFps(): void {
  lowFpsReported = true;
  try {
    window.sessionStorage.setItem(FPS_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(FPS_EVENT));
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

let webgl2Cache: boolean | undefined;

interface NavigatorExtras {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function readTier(): RenderTier {
  const nav = navigator as Navigator & NavigatorExtras;
  webgl2Cache ??= hasWebGL2();
  const tier = computeRenderTier({
    reducedMotion: window.matchMedia(RM_QUERY).matches,
    saveData: nav.connection?.saveData === true,
    // "on" overrides nothing downward; only "reduce" forces static.
    userReduce: readMotionPref() === "reduce",
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    webgl2: webgl2Cache,
    fpsBelow50: readLowFps(),
  });
  // Drops are sticky within a session, except that an explicit static->motion
  // change by the user (reduce toggled off) is allowed to recover from static.
  stickyTier = tier === "static" ? "static" : minTier(stickyTier === "static" ? "full" : stickyTier, tier);
  return stickyTier;
}

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", cb);
  window.addEventListener(MOTION_EVENT, cb);
  window.addEventListener(FPS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener(MOTION_EVENT, cb);
    window.removeEventListener(FPS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const getServerSnapshot = (): RenderTier => "static";

/** 'static' on SSR and the hydration render, then the resolved tier. */
export function useRenderTier(): RenderTier {
  return useSyncExternalStore(subscribe, readTier, getServerSnapshot);
}
