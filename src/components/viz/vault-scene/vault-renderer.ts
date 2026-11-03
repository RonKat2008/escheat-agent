/**
 * The Vault, framework-free (OGL). Used by the React wrapper (VaultScene.tsx) and by scripts/render-vault-poster.ts,
 * which renders the rest frame to the static poster. Owns no timers: the caller drives `frame()`.
 */
import { Box, Camera, Geometry, Mesh, Plane, Program, Renderer, Transform } from "ogl";
import { VAULT_RGB } from "./palette";
import {
  buildParticles,
  buildThreads,
  cameraAt,
  cameraKeys,
  curveUniform,
  damp,
  FOV_DEG,
  gatePosition,
  GATE_RADIUS,
  layoutSlabs,
  PYLON_HEIGHT,
  PYLON_WIDTH,
  PYLON_X,
  PYLON_Z,
  pylonShare,
  RECOVERED_PAD,
  sampleCurve,
  STATE_CODES,
  type CameraKey,
  type Curve,
} from "./scene-math";
import * as S from "./shaders";

export interface VaultRendererOptions {
  canvas: HTMLCanvasElement;
  dpr: number;
  particles: number;
  /** Keep the drawing buffer so the poster script can read pixels back. */
  preserveDrawingBuffer?: boolean;
}

export interface VaultRenderer {
  readonly curves: readonly Curve[];
  readonly keys: readonly CameraKey[];
  resize(width: number, height: number): void;
  setDpr(dpr: number): void;
  setParticles(count: number): void;
  /** Advance and draw. `time` in seconds; `cameraTarget` is 0 (rest) .. 4 (step 4); dt in seconds for damping. */
  frame(time: number, cameraTarget: number, dt: number): CameraKey;
  /** Jump the camera without damping (poster, reduced motion). */
  snapCamera(p: number): void;
  destroy(): void;
}

const ADDITIVE = (gl: WebGLRenderingContext, program: Program) => {
  program.setBlendFunc(gl.SRC_ALPHA, gl.ONE);
};

export function createVaultRenderer(opts: VaultRendererOptions): VaultRenderer {
  const renderer = new Renderer({
    canvas: opts.canvas,
    dpr: opts.dpr,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
  });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);

  const camera = new Camera(gl, { fov: FOV_DEG, near: 0.1, far: 80 });
  const scene = new Transform();

  const slabs = layoutSlabs();
  const curves = buildThreads(slabs);
  const keys = cameraKeys(curves);
  const time = { value: 0 };

  // Floor
  const floor = new Mesh(gl, {
    geometry: new Plane(gl, { width: 80, height: 60 }),
    program: new Program(gl, {
      vertex: S.FLOOR_VERT,
      fragment: S.FLOOR_FRAG,
      uniforms: { uGrid: { value: VAULT_RGB.blue400 }, uWash: { value: VAULT_RGB.blue950 } },
      depthWrite: false,
    }),
  });
  floor.rotation.x = -Math.PI / 2;
  floor.setParent(scene);

  // Ledger slabs (instanced)
  const slabBox = new Box(gl, { width: 0.36, height: 0.05, depth: 0.22 });
  const slabGeo = new Geometry(gl, {
    position: slabBox.attributes.position!,
    normal: slabBox.attributes.normal!,
    uv: slabBox.attributes.uv!,
    index: slabBox.attributes.index!,
    aOffset: { instanced: 1, size: 3, data: slabs.offsets },
    aInfo: { instanced: 1, size: 3, data: slabs.info },
  });
  const lift = { value: 1 };
  const focus = { value: 0 };
  new Mesh(gl, {
    geometry: slabGeo,
    program: new Program(gl, {
      vertex: S.SLAB_VERT,
      fragment: S.SLAB_FRAG,
      uniforms: {
        uTime: time,
        uLift: lift,
        uFocus: focus,
        uTop: { value: VAULT_RGB.ink3 },
        uSide: { value: VAULT_RGB.ink2 },
        uEdge: { value: VAULT_RGB.fg3 },
        uStaleTop: { value: VAULT_RGB.blue800 },
        uStaleEdge: { value: VAULT_RGB.blue300 },
      },
    }),
  }).setParent(scene);

  // Pylons (instanced), filled in proportion to each state's stale count.
  const pylonBox = new Box(gl, { width: 1, height: 1, depth: 1 });
  const pOffsets = new Float32Array(STATE_CODES.flatMap((c) => [PYLON_X[c], PYLON_HEIGHT / 2, PYLON_Z]));
  const pInfo = new Float32Array(STATE_CODES.flatMap((c, i) => [i, pylonShare(c)]));
  new Mesh(gl, {
    geometry: new Geometry(gl, {
      position: pylonBox.attributes.position!,
      normal: pylonBox.attributes.normal!,
      uv: pylonBox.attributes.uv!,
      index: pylonBox.attributes.index!,
      aOffset: { instanced: 1, size: 3, data: pOffsets },
      aInfo: { instanced: 1, size: 2, data: pInfo },
    }),
    program: new Program(gl, {
      vertex: S.PYLON_VERT,
      fragment: S.PYLON_FRAG,
      uniforms: {
        uTime: time,
        uScale: { value: [PYLON_WIDTH, PYLON_HEIGHT, PYLON_WIDTH] },
        uBody: { value: VAULT_RGB.ink2 },
        uEdge: { value: VAULT_RGB.blue400 },
        uFill: { value: VAULT_RGB.blue500 },
        uHot: { value: VAULT_RGB.blue200 },
      },
    }),
  }).setParent(scene);

  // Recovered pad
  const pad = new Mesh(gl, {
    geometry: new Plane(gl, { width: 2.4, height: 1.6 }),
    program: new Program(gl, {
      vertex: S.PAD_VERT,
      fragment: S.PAD_FRAG,
      uniforms: { uTime: time, uColor: { value: VAULT_RGB.blue300 } },
      transparent: true,
      depthWrite: false,
    }),
  });
  ADDITIVE(gl, pad.program);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(RECOVERED_PAD[0], RECOVERED_PAD[1] + 0.01, RECOVERED_PAD[2]);
  pad.setParent(scene);

  // Thread lines (gl.LINES pairs, revealed by uReveal)
  const SAMPLES = 96;
  const linePos: number[] = [];
  const lineData: number[] = [];
  curves.forEach((c, ti) => {
    const pts = sampleCurve(c, SAMPLES);
    for (let i = 0; i < SAMPLES - 1; i++) {
      linePos.push(...pts[i]!, ...pts[i + 1]!);
      lineData.push(i / (SAMPLES - 1), ti, (i + 1) / (SAMPLES - 1), ti);
    }
  });
  const reveal = { value: 0 };
  const threads = new Mesh(gl, {
    mode: gl.LINES,
    geometry: new Geometry(gl, {
      position: { size: 3, data: new Float32Array(linePos) },
      aData: { size: 2, data: new Float32Array(lineData) },
    }),
    program: new Program(gl, {
      vertex: S.THREAD_VERT,
      fragment: S.THREAD_FRAG,
      uniforms: { uColor: { value: VAULT_RGB.blue400 }, uReveal: reveal, uTime: time },
      transparent: true,
      depthWrite: false,
    }),
  });
  ADDITIVE(gl, threads.program);
  threads.setParent(scene);

  // Gate rings: an annulus in the XY plane at each forward thread's gate.
  const SEG = 72;
  const ringPos: number[] = [];
  const ringIdx: number[] = [];
  const r0 = GATE_RADIUS - 0.24;
  const r1 = GATE_RADIUS + 0.24;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    ringPos.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    if (i < SEG) {
      const k = i * 2;
      ringIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const gates = curves.slice(0, 3).map(gatePosition);
  const gateMesh = new Mesh(gl, {
    geometry: new Geometry(gl, {
      position: { size: 3, data: new Float32Array(ringPos) },
      index: { data: new Uint16Array(ringIdx) },
      aOffset: { instanced: 1, size: 3, data: new Float32Array(gates.flat()) },
      aIndex: { instanced: 1, size: 1, data: new Float32Array([0, 1, 2]) },
    }),
    program: new Program(gl, {
      vertex: S.GATE_VERT,
      fragment: S.GATE_FRAG,
      uniforms: { uTime: time, uIdle: { value: VAULT_RGB.blue400 }, uHuman: { value: VAULT_RGB.pink500 }, uHot: { value: VAULT_RGB.pink400 } },
      transparent: true,
      depthWrite: false,
      cullFace: false,
    }),
  });
  ADDITIVE(gl, gateMesh.program);
  gateMesh.setParent(scene);

  // Particles
  const parts = buildParticles();
  const dprU = { value: renderer.dpr };
  const particleGeo = new Geometry(gl, {
    position: { size: 3, data: parts.jitter },
    aData: { size: 3, data: parts.data },
  });
  const particles = new Mesh(gl, {
    mode: gl.POINTS,
    geometry: particleGeo,
    program: new Program(gl, {
      vertex: S.PARTICLE_VERT,
      fragment: S.PARTICLE_FRAG,
      uniforms: {
        uCtrl: { value: curveUniform(curves) },
        uTime: time,
        uSize: { value: 16 },
        uDpr: dprU,
        uBlue: { value: VAULT_RGB.blue400 },
        uPink: { value: VAULT_RGB.pink500 },
        uHot: { value: VAULT_RGB.blue200 },
      },
      transparent: true,
      depthWrite: false,
    }),
  });
  ADDITIVE(gl, particles.program);
  particles.setParent(scene);

  let camP = 0;
  let width = 1;
  let height = 1;
  let introT = 0;

  function applyCamera(p: number): CameraKey {
    const k = cameraAt(keys, p);
    camera.position.set(k.pos[0], k.pos[1], k.pos[2]);
    camera.lookAt([k.target[0], k.target[1], k.target[2]]);
    return k;
  }

  const api: VaultRenderer = {
    curves,
    keys,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height);
      camera.perspective({ aspect: width / height });
    },
    setDpr(dpr) {
      renderer.dpr = dpr;
      dprU.value = dpr;
      renderer.setSize(width, height);
    },
    setParticles(count) {
      particleGeo.setDrawRange(0, Math.max(0, Math.min(parts.count, count)));
    },
    snapCamera(p) {
      camP = p;
      introT = 10;
    },
    frame(t, target, dt) {
      time.value = t;
      introT += dt;
      reveal.value = Math.min(1, introT / 1.4);
      camP = damp(camP, target, 3.2, dt);
      focus.value = Math.max(0, 1 - Math.abs(camP - 1));
      lift.value = Math.min(1, introT / 0.9);
      const k = applyCamera(camP);
      renderer.render({ scene, camera });
      return k;
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  api.setParticles(opts.particles);
  return api;
}
