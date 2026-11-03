/**
 * Pure math for "The Vault" (DESIGN-V3 §3.1). No DOM, no WebGL: the OGL renderer, the poster script and the DOM
 * label overlay all read the same layout, curves, timeline and camera from here, so the poster and the live scene
 * match frame for frame. The GLSL in shaders.ts mirrors `particleState`, `gateHold`, `pylonFill` and `recoveryU`.
 *
 * Figures are the synthetic demo's documented invariants (fixtures/synthetic/README.md): 733 ledger rows, 47 stale,
 * owner states CA 21 / TX 15 / DE 11. No dollar amounts appear in the scene.
 */
import type { RenderTier } from "@/components/viz/core/render-tier";

export type Vec3 = readonly [number, number, number];

/** Rows in fixtures/synthetic/ledger.csv: one slab each. */
export const LEDGER_ITEMS = 733;
export const STATE_CODES = ["CA", "TX", "DE"] as const;
export type StateCode = (typeof STATE_CODES)[number];
/** Stale items by owner state in the synthetic demo (README "Running the demo"). */
export const STALE_BY_STATE: Readonly<Record<StateCode, number>> = { CA: 21, TX: 15, DE: 11 };
export const STALE_ITEMS = STALE_BY_STATE.CA + STALE_BY_STATE.TX + STALE_BY_STATE.DE;

export const GRID_COLS = 37;
export const GRID_ROWS = 20;
const PITCH_X = 0.42;
const PITCH_Z = 0.3;
const FIELD_Z0 = 0.4;

/** Pylon x positions, west to east as on a map: CA left, TX centre, DE right. */
export const PYLON_X: Readonly<Record<StateCode, number>> = { CA: -6.2, TX: 0, DE: 6.2 };
export const PYLON_Z = -7.2;
export const PYLON_HEIGHT = 4.2;
export const PYLON_WIDTH = 1.1;
export const RECOVERED_PAD: Vec3 = [8.4, 0.02, 0.6];

/** Where along each forward thread the human gate sits. */
export const GATE_U = 0.42;
export const GATE_RADIUS = 0.6;

/** One loop of the story, seconds. */
export const CYCLE_S = 9;
export const LAUNCH_WINDOW_S = 3.2;
/** Thread speed in curve units per second. */
export const SPEED = 0.33;
export const GATE_OPEN_S = 5.2;
export const RELEASE_SPREAD_S = 0.9;
export const THREAD_OFFSET_S = 0.35;
export const RECOVERY_START_S = 6.4;
export const RECOVERY_SPEED = 0.62;

export const MAX_PARTICLES = 600;
export const RECOVERY_PARTICLES = 80;

export interface SlabLayout {
  count: number;
  /** xyz per slab. */
  offsets: Float32Array;
  /** (stale 0|1, state index or -1, phase 0..1) per slab. */
  info: Float32Array;
  /** Centroid of each state's stale slabs (thread origins). */
  centroids: Readonly<Record<StateCode, Vec3>>;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic slab field: 733 slabs on a 37x20 grid, 47 lifted (stale), assigned to states west to east. */
export function layoutSlabs(seed = 10482): SlabLayout {
  const rand = mulberry32(seed);
  const count = LEDGER_ITEMS;
  const offsets = new Float32Array(count * 3);
  const info = new Float32Array(count * 3);
  const x0 = -((GRID_COLS - 1) * PITCH_X) / 2;
  for (let i = 0; i < count; i++) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    offsets[i * 3] = x0 + col * PITCH_X;
    offsets[i * 3 + 1] = 0;
    offsets[i * 3 + 2] = FIELD_Z0 + row * PITCH_Z;
    info[i * 3 + 1] = -1;
    info[i * 3 + 2] = rand();
  }
  // Pick STALE_ITEMS distinct slabs, then order them by x so each state's slabs sit under its pylon.
  const picked = new Set<number>();
  while (picked.size < STALE_ITEMS) picked.add(Math.floor(rand() * count));
  const byX = [...picked].sort((a, b) => offsets[a * 3]! - offsets[b * 3]! || a - b);
  const sums: Record<StateCode, [number, number, number, number]> = { CA: [0, 0, 0, 0], TX: [0, 0, 0, 0], DE: [0, 0, 0, 0] };
  let cursor = 0;
  STATE_CODES.forEach((code, s) => {
    for (let k = 0; k < STALE_BY_STATE[code]; k++) {
      const i = byX[cursor++]!;
      info[i * 3] = 1;
      info[i * 3 + 1] = s;
      const acc = sums[code];
      acc[0] += offsets[i * 3]!;
      acc[1] += offsets[i * 3 + 2]!;
      acc[3] += 1;
    }
  });
  const centroid = (code: StateCode): Vec3 => {
    const [sx, sz, , n] = sums[code];
    return [sx / n, 0.45, sz / n];
  };
  return { count, offsets, info, centroids: { CA: centroid("CA"), TX: centroid("TX"), DE: centroid("DE") } };
}

export interface Curve {
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
}

export function bezier(c: Curve, t: number): Vec3 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * c.p0[0] + b * c.p1[0] + d * c.p2[0] + e * c.p3[0],
    a * c.p0[1] + b * c.p1[1] + d * c.p2[1] + e * c.p3[1],
    a * c.p0[2] + b * c.p1[2] + d * c.p2[2] + e * c.p3[2],
  ];
}

/** n evenly spaced parameter samples, endpoints included. */
export function sampleCurve(c: Curve, n: number): Vec3[] {
  if (n < 2) throw new RangeError("sampleCurve needs at least 2 samples");
  return Array.from({ length: n }, (_, i) => bezier(c, i / (n - 1)));
}

export function pylonTop(code: StateCode): Vec3 {
  return [PYLON_X[code], PYLON_HEIGHT * 0.62, PYLON_Z + PYLON_WIDTH / 2 + 0.05];
}

/** Three forward threads (stale cluster -> state pylon) and one reverse thread (TX pylon -> Recovered pad). */
export function buildThreads(slabs: Pick<SlabLayout, "centroids">): Curve[] {
  const forward = STATE_CODES.map((code): Curve => {
    const p0 = slabs.centroids[code];
    const p3 = pylonTop(code);
    return {
      p0,
      p1: [p0[0], p0[1] + 2.6, p0[2] - 1.6],
      p2: [p3[0], p3[1] + 2.2, p3[2] + 4.2],
      p3,
    };
  });
  const from = pylonTop("TX");
  const pad = RECOVERED_PAD;
  const reverse: Curve = {
    p0: [from[0] + 0.4, from[1] - 0.6, from[2]],
    p1: [from[0] + 3.5, from[1] + 2.8, from[2] + 1.5],
    p2: [pad[0] - 1.2, 2.8, pad[2] - 2.6],
    p3: [pad[0], pad[1] + 0.15, pad[2]],
  };
  return [...forward, reverse];
}

export function gatePosition(curve: Curve): Vec3 {
  return bezier(curve, GATE_U);
}

/**
 * Control points (4 curves x 4 points) for the `uCtrl[16]` uniform. A plain array of vec3s: OGL only binds uniform
 * arrays whose value is an Array (a Float32Array is skipped with a "not supplied" warning).
 */
export function curveUniform(curves: readonly Curve[]): number[][] {
  return curves.flatMap((c) => [c.p0, c.p1, c.p2, c.p3].map((p) => [p[0], p[1], p[2]]));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Cycle-local time for a thread (threads are offset so they do not move in lockstep). */
export function threadTime(t: number, thread: number): number {
  const c = (t + thread * THREAD_OFFSET_S) % CYCLE_S;
  return c < 0 ? c + CYCLE_S : c;
}

export interface ParticleState {
  /** Curve parameter; < 0 not launched yet, > 1 arrived. */
  u: number;
  /** 0 travelling, 1 held on the gate ring (pink). */
  hold: number;
}

/**
 * A forward particle: launches inside the launch window, travels to the gate, waits there until its staggered
 * release after GATE_OPEN_S, then continues to the pylon. Mirrors the vertex shader.
 */
export function particleState(c: number, seed: number, seed2: number): ParticleState {
  const launch = seed * LAUNCH_WINDOW_S;
  const arrive = launch + GATE_U / SPEED;
  const open = GATE_OPEN_S + seed2 * RELEASE_SPREAD_S;
  let u: number;
  if (c < launch) u = (c - launch) * SPEED;
  else if (c < open) u = Math.min((c - launch) * SPEED, GATE_U);
  else if (arrive < open) u = GATE_U + (c - open) * SPEED;
  else u = (c - launch) * SPEED;
  const hold = smoothstep(arrive, arrive + 0.3, c) * (1 - smoothstep(open, open + 0.3, c));
  return { u, hold };
}

/** How strongly a gate glows pink: rises as light arrives, falls as it is released. */
export function gateHold(c: number): number {
  const firstArrive = GATE_U / SPEED;
  return smoothstep(firstArrive, firstArrive + 0.5, c) * (1 - smoothstep(GATE_OPEN_S, GATE_OPEN_S + RELEASE_SPREAD_S + 0.3, c));
}

/** Pylon fill 0..1 within a cycle (scaled per state by its share of stale items). */
export function pylonFill(c: number): number {
  const arriveFirst = GATE_OPEN_S + (1 - GATE_U) / SPEED;
  return smoothstep(arriveFirst - 0.2, arriveFirst + 1.4, c) * (1 - smoothstep(CYCLE_S - 0.5, CYCLE_S, c));
}

/** The reverse (recovery) thread, active late in the cycle. */
export function recoveryU(c: number, seed: number): number {
  return (c - RECOVERY_START_S - seed * 1.1) * RECOVERY_SPEED;
}

/** Relative pylon heights: each state's share of the largest stale count. */
export function pylonShare(code: StateCode): number {
  const max = Math.max(...Object.values(STALE_BY_STATE));
  return STALE_BY_STATE[code] / max;
}

/** Forward particles split by stale count (CA 21 : TX 15 : DE 11), then the recovery thread. */
export function particleCounts(total = MAX_PARTICLES): number[] {
  const forward = total - RECOVERY_PARTICLES;
  const ca = Math.round((forward * STALE_BY_STATE.CA) / STALE_ITEMS);
  const tx = Math.round((forward * STALE_BY_STATE.TX) / STALE_ITEMS);
  return [ca, tx, forward - ca - tx, RECOVERY_PARTICLES];
}

export interface ParticleBuffers {
  /** (thread, seed, seed2) per particle, interleaved across threads so a prefix of any length is balanced. */
  data: Float32Array;
  /** small jitter offset per particle */
  jitter: Float32Array;
  count: number;
}

export function buildParticles(seed = 733): ParticleBuffers {
  const rand = mulberry32(seed);
  const counts = particleCounts();
  const total = counts.reduce((a, b) => a + b, 0);
  const queues = counts.map((n, thread) => Array.from({ length: n }, () => [thread, rand(), rand()] as const));
  const order: (readonly [number, number, number])[] = [];
  // Weighted round robin: always take from the thread that is furthest behind its share.
  const taken = counts.map(() => 0);
  for (let k = 0; k < total; k++) {
    let best = 0;
    let bestLag = -Infinity;
    counts.forEach((n, t) => {
      if (taken[t]! >= n) return;
      const lag = (n * (k + 1)) / total - taken[t]!;
      if (lag > bestLag) {
        bestLag = lag;
        best = t;
      }
    });
    order.push(queues[best]![taken[best]!]!);
    taken[best]! += 1;
  }
  const data = new Float32Array(total * 3);
  const jitter = new Float32Array(total * 3);
  order.forEach((p, i) => {
    data.set(p, i * 3);
    jitter[i * 3] = rand() * 2 - 1;
    jitter[i * 3 + 1] = rand() * 2 - 1;
    jitter[i * 3 + 2] = rand() * 2 - 1;
  });
  return { data, jitter, count: total };
}

/* ---------- camera ---------- */

export interface CameraKey {
  pos: Vec3;
  target: Vec3;
}

export const FOV_DEG = 32;

/** Rest frame (hero, poster) then the four "How it works" steps. */
export function cameraKeys(curves: readonly Curve[]): CameraKey[] {
  const gate = gatePosition(curves[1]!); // TX, the centre thread
  return [
    { pos: [0, 14.5, 20.5], target: [0.6, 1.5, -1.8] },
    { pos: [-2.6, 8.2, 12.6], target: [-0.4, 0, 2.6] },
    { pos: [0, 9.4, 15.2], target: [0, 1.8, -2.6] },
    { pos: [gate[0] - 2.2, gate[1] + 2.2, gate[2] + 8.2], target: [gate[0] + 0.4, gate[1] - 0.4, gate[2] - 1.6] },
    { pos: [7.6, 8.6, 13.4], target: [3.4, 1.4, -2.6] },
  ];
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Camera at progress p in [0, keys-1], eased between keyframes. */
export function cameraAt(keys: readonly CameraKey[], p: number): CameraKey {
  const max = keys.length - 1;
  const q = Math.min(max, Math.max(0, p));
  const i = Math.min(max - 1, Math.floor(q));
  const t = smoothstep(0, 1, q - i);
  return { pos: lerp3(keys[i]!.pos, keys[i + 1]!.pos, t), target: lerp3(keys[i]!.target, keys[i + 1]!.target, t) };
}

/** Frame-rate independent exponential approach (lambda per second). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * Projects a world point to normalized viewport coords (0..1, y down) for a camera looking at `target`.
 * Returns null when the point is behind the camera.
 */
export function project(point: Vec3, cam: CameraKey, aspect: number, fovDeg = FOV_DEG): { x: number; y: number } | null {
  const f = normalize(sub(cam.target, cam.pos));
  const r = normalize(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(point, cam.pos);
  const z = dot(d, f);
  if (z <= 0.01) return null;
  const k = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const ndcX = (dot(d, r) * k) / (z * aspect);
  const ndcY = (dot(d, u) * k) / z;
  return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Scroll progress (0..1 over the steps list) to camera progress (0 = rest .. 4 = step 4). */
export function stepsToCamera(v: number, steps = 4): number {
  return Math.min(steps, Math.max(0, v * (steps + 0.5)));
}

/* ---------- tiers ---------- */

export interface TierSettings {
  dprCap: number;
  particles: number;
}

export function tierSettings(tier: RenderTier, devicePixelRatio = 1): TierSettings {
  if (tier === "full") return { dprCap: Math.min(devicePixelRatio || 1, 2), particles: MAX_PARTICLES };
  if (tier === "lite") return { dprCap: 1, particles: Math.floor(MAX_PARTICLES / 2) };
  return { dprCap: 1, particles: 0 };
}

export const FPS_PROBE_FRAMES = 90;
export const FPS_WARMUP_FRAMES = 10;

/**
 * Verdict from an FPS probe (frame deltas in ms, warm-up frames already dropped): under 30fps falls back to the
 * poster, under 50fps to lite, otherwise keeps the current tier. Never upgrades.
 */
export function fpsVerdict(deltasMs: readonly number[], current: RenderTier): RenderTier {
  if (deltasMs.length === 0 || current === "static") return current;
  const avg = deltasMs.reduce((a, b) => a + b, 0) / deltasMs.length;
  const fps = 1000 / avg;
  if (fps < 30) return "static";
  if (fps < 50) return "lite";
  return current;
}
