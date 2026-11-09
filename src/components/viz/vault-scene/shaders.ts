/**
 * GLSL ES 1.00 shaders for The Vault. Timeline constants are injected from scene-math.ts so the GPU and the unit-tested
 * TypeScript mirror (particleState, gateHold, pylonFill, recoveryU) cannot drift apart.
 */
import {
  CYCLE_S,
  GATE_OPEN_S,
  GATE_RADIUS,
  GATE_U,
  LAUNCH_WINDOW_S,
  RECOVERY_SPEED,
  RECOVERY_START_S,
  RELEASE_SPREAD_S,
  SPEED,
  THREAD_OFFSET_S,
} from "./scene-math";

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

const TIMELINE = /* glsl */ `
const float CYCLE = ${f(CYCLE_S)};
const float LAUNCH = ${f(LAUNCH_WINDOW_S)};
const float SPEED = ${f(SPEED)};
const float GATE_U = ${f(GATE_U)};
const float GATE_OPEN = ${f(GATE_OPEN_S)};
const float SPREAD = ${f(RELEASE_SPREAD_S)};
const float OFFSET = ${f(THREAD_OFFSET_S)};
const float REC_START = ${f(RECOVERY_START_S)};
const float REC_SPEED = ${f(RECOVERY_SPEED)};
float threadTime(float t, float thread) { return mod(t + thread * OFFSET, CYCLE); }
float gateHold(float c) {
  float first = GATE_U / SPEED;
  return smoothstep(first, first + 0.5, c) * (1.0 - smoothstep(GATE_OPEN, GATE_OPEN + SPREAD + 0.3, c));
}
float pylonFill(float c) {
  float a = GATE_OPEN + (1.0 - GATE_U) / SPEED;
  return smoothstep(a - 0.2, a + 1.4, c) * (1.0 - smoothstep(CYCLE - 0.5, CYCLE, c));
}
`;

const FOG = /* glsl */ `
float fog(float depth) { return smoothstep(14.0, 34.0, depth); }
`;

export const FLOOR_VERT = /* glsl */ `
attribute vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const FLOOR_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uGrid;
uniform vec3 uWash;
varying vec3 vWorld;
float gridLine(vec2 p, float w) {
  vec2 g = abs(fract(p) - 0.5);
  return smoothstep(0.5 - w, 0.5, max(g.x, g.y));
}
void main() {
  vec2 p = vWorld.xz;
  float d = length((p - vec2(0.0, -1.5)) * vec2(0.75, 1.0));
  float fade = 1.0 - smoothstep(4.0, 17.0, d);
  float minor = gridLine(p, 0.03) * 0.11;
  float major = gridLine(p / 4.0, 0.01) * 0.26;
  vec3 col = uGrid * (minor + major) * fade;
  col += uWash * (1.0 - smoothstep(0.0, 13.0, d)) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SLAB_VERT = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec3 aOffset;
attribute vec3 aInfo;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uLift;
varying vec3 vNormal;
varying vec2 vUv;
varying float vStale;
varying float vDepth;
varying float vPhase;
void main() {
  float stale = aInfo.x;
  float bob = sin(uTime * 1.3 + aInfo.z * 6.2831) * 0.06;
  vec3 p = position + aOffset + vec3(0.0, stale * (uLift * 0.42 + bob * uLift), 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normal;
  vUv = uv;
  vStale = stale;
  vPhase = aInfo.z;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const SLAB_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop;
uniform vec3 uSide;
uniform vec3 uEdge;
uniform vec3 uStaleTop;
uniform vec3 uStaleEdge;
uniform float uFocus;
uniform float uTime;
varying vec3 vNormal;
varying vec2 vUv;
varying float vStale;
varying float vDepth;
varying float vPhase;
${FOG}
void main() {
  float top = step(0.5, vNormal.y);
  vec2 e2 = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.09, 0.0, min(e2.x, e2.y));
  vec3 base = mix(uSide, uTop, top);
  vec3 col = base + uEdge * edge * (0.18 + 0.12 * top);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + vPhase * 6.2831);
  vec3 stale = mix(uSide * 1.4, uStaleTop, top) + uStaleEdge * edge * (0.65 + 0.35 * uFocus) * pulse;
  col = mix(col, stale, vStale);
  col = mix(col, vec3(0.043, 0.078, 0.188), fog(vDepth));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const PYLON_VERT = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec3 aOffset;
attribute vec2 aInfo;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uScale;
uniform float uTime;
varying vec3 vNormal;
varying vec2 vUv;
varying float vY;
varying float vFill;
varying float vDepth;
${TIMELINE}
void main() {
  vec3 p = position * uScale + aOffset;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normal;
  vUv = uv;
  vY = position.y + 0.5;
  vFill = pylonFill(threadTime(uTime, aInfo.x)) * aInfo.y;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PYLON_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBody;
uniform vec3 uEdge;
uniform vec3 uFill;
uniform vec3 uHot;
varying vec3 vNormal;
varying vec2 vUv;
varying float vY;
varying float vFill;
varying float vDepth;
${FOG}
void main() {
  vec2 e2 = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.05, 0.0, min(e2.x, e2.y));
  float filled = step(vY, vFill * 0.92 + 0.04);
  float surface = smoothstep(0.03, 0.0, abs(vY - (vFill * 0.92 + 0.04))) * step(0.01, vFill);
  vec3 col = uBody + uEdge * edge * 0.85;
  col = mix(col, uFill * (0.55 + 0.45 * vY) + uEdge * edge * 0.3, filled * 0.9);
  col += uHot * surface * 0.8;
  col = mix(col, vec3(0.043, 0.078, 0.188), fog(vDepth) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const GATE_VERT = /* glsl */ `
attribute vec3 position;
attribute vec3 aOffset;
attribute float aIndex;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
varying float vR;
varying float vHold;
${TIMELINE}
void main() {
  vR = length(position.xy);
  vHold = gateHold(threadTime(uTime, aIndex));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aOffset, 1.0);
}
`;

export const GATE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uIdle;
uniform vec3 uHuman;
uniform vec3 uHot;
varying float vR;
varying float vHold;
void main() {
  float d = abs(vR - ${f(GATE_RADIUS)});
  float core = 1.0 - smoothstep(0.0, 0.035, d);
  float halo = (1.0 - smoothstep(0.0, 0.22, d)) * 0.35;
  vec3 col = mix(uIdle, uHuman, vHold);
  float a = core * (0.45 + 0.55 * vHold) + halo * (0.25 + 0.75 * vHold);
  gl_FragColor = vec4(col * a + uHot * core * vHold * 0.35, a);
}
`;

export const THREAD_VERT = /* glsl */ `
attribute vec3 position;
attribute vec2 aData;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying float vU;
varying float vThread;
void main() {
  vU = aData.x;
  vThread = aData.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const THREAD_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uReveal;
uniform float uTime;
varying float vU;
varying float vThread;
${TIMELINE}
void main() {
  if (vU > uReveal) discard;
  float c = threadTime(uTime, vThread);
  float a = 0.5 + 0.3 * smoothstep(0.0, 0.25, vU);
  if (vThread > 2.5) a *= smoothstep(REC_START - 0.6, REC_START, c) * (1.0 - smoothstep(CYCLE - 0.6, CYCLE, c)) * 1.3;
  gl_FragColor = vec4(uColor * a, a);
}
`;

export const PARTICLE_VERT = /* glsl */ `
attribute vec3 position;
attribute vec3 aData;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCtrl[16];
uniform float uTime;
uniform float uSize;
uniform float uDpr;
varying float vAlpha;
varying float vPink;
varying float vHot;
${TIMELINE}
vec3 bez(int i, float t) {
  vec3 p0 = uCtrl[i * 4];
  vec3 p1 = uCtrl[i * 4 + 1];
  vec3 p2 = uCtrl[i * 4 + 2];
  vec3 p3 = uCtrl[i * 4 + 3];
  float u = 1.0 - t;
  return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
}
void main() {
  float thread = aData.x;
  float seed = aData.y;
  float seed2 = aData.z;
  float c = threadTime(uTime, thread);
  int ti = int(thread + 0.5);
  float u;
  float hold = 0.0;
  if (thread > 2.5) {
    u = (c - REC_START - seed * 1.1) * REC_SPEED;
  } else {
    float launch = seed * LAUNCH;
    float arrive = launch + GATE_U / SPEED;
    float open = GATE_OPEN + seed2 * SPREAD;
    if (c < launch) u = (c - launch) * SPEED;
    else if (c < open) u = min((c - launch) * SPEED, GATE_U);
    else if (arrive < open) u = GATE_U + (c - open) * SPEED;
    else u = (c - launch) * SPEED;
    hold = smoothstep(arrive, arrive + 0.3, c) * (1.0 - smoothstep(open, open + 0.3, c));
  }
  float uc = clamp(u, 0.0, 1.0);
  vec3 p = bez(ti, uc) + position * 0.07;
  if (hold > 0.0) {
    vec3 g = bez(ti, GATE_U);
    float ang = seed * 6.2831 + uTime * (0.7 + seed2 * 0.6);
    vec3 ring = g + vec3(cos(ang), sin(ang), 0.0) * ${f(GATE_RADIUS)} * (0.9 + 0.12 * position.x);
    p = mix(p, ring, hold);
  }
  float alive = step(0.0, u) * (1.0 - smoothstep(0.94, 1.0, u));
  vAlpha = alive * smoothstep(0.0, 0.05, u + 0.001);
  vPink = hold;
  vHot = 0.5 + 0.5 * sin(seed * 40.0 + uTime * 3.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uDpr * (1.0 + 0.6 * hold) * (10.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBlue;
uniform vec3 uPink;
uniform vec3 uHot;
varying float vAlpha;
varying float vPink;
varying float vHot;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = 1.0 - smoothstep(0.0, 0.5, r);
  a *= a;
  vec3 col = mix(uBlue, uPink, vPink);
  col = mix(col, uHot, (1.0 - smoothstep(0.0, 0.16, r)) * (0.4 + 0.3 * vHot));
  float alpha = a * vAlpha;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const PAD_VERT = /* glsl */ `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PAD_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
${TIMELINE}
void main() {
  float c = threadTime(uTime, 3.0);
  float glow = smoothstep(REC_START + 1.2, REC_START + 2.2, c) * (1.0 - smoothstep(CYCLE - 0.5, CYCLE, c));
  vec2 e2 = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.04, 0.0, min(e2.x, e2.y));
  float inner = smoothstep(0.16, 0.12, min(e2.x, e2.y)) * smoothstep(0.1, 0.12, min(e2.x, e2.y));
  float a = edge * (0.45 + 0.55 * glow) + inner * 0.25 + glow * 0.12;
  gl_FragColor = vec4(uColor * a, a);
}
`;
