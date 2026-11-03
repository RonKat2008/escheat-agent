/** Pure render-tier logic (no React) so it can be unit tested in node. */

export type RenderTier = "full" | "lite" | "static";

export interface TierSignals {
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** navigator.connection.saveData */
  saveData: boolean;
  /** localStorage es-motion === "reduce" */
  userReduce: boolean;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  webgl2: boolean;
  /** FPS probe reported < 50fps this session */
  fpsBelow50: boolean;
}

export const MOTION_KEY = "es-motion";
export const MOTION_EVENT = "es-motion-change";
export type MotionPref = "reduce" | "system" | "on";

export function computeRenderTier(s: TierSignals): RenderTier {
  if (s.reducedMotion || s.saveData || s.userReduce) return "static";
  const lowCores = typeof s.hardwareConcurrency === "number" && s.hardwareConcurrency > 0 && s.hardwareConcurrency <= 4;
  const lowMem = typeof s.deviceMemory === "number" && s.deviceMemory > 0 && s.deviceMemory <= 4;
  if (lowCores || lowMem || !s.webgl2 || s.fpsBelow50) return "lite";
  return "full";
}

const TIER_RANK: Record<RenderTier, number> = { static: 0, lite: 1, full: 2 };

/** Returns the lower of two tiers; a tier never upgrades once dropped. */
export function minTier(a: RenderTier, b: RenderTier): RenderTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export const FPS_FLAG_KEY = "es-low-fps";
export const FPS_EVENT = "es-fps-change";
