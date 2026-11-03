"use client";

import { useEffect, useRef } from "react";
import type { CanvasSceneProps } from "@/components/viz/core/LazyCanvas";
import { reportLowFps } from "@/components/viz/core/useRenderTier";
import type { RenderTier } from "@/components/viz/core/render-tier";
import { FPS_PROBE_FRAMES, FPS_WARMUP_FRAMES, fpsVerdict, tierSettings } from "./scene-math";
import { createVaultRenderer, type VaultRenderer } from "./vault-renderer";
import { getVaultCameraTarget, publishVaultCamera, resetVaultCamera } from "./vault-store";

export interface VaultSceneProps extends CanvasSceneProps {
  /** The FPS probe asks for a lower tier ("static" = fall back to the poster). */
  onFloor?: (tier: RenderTier) => void;
}

const MAX_DT = 1 / 20;

/**
 * The live OGL scene. Renders only while on screen and the tab is visible; probes the first 90 frames and drops to
 * lite (< 50fps) or back to the poster (< 30fps). Mounted by LazyCanvas after idle; never under the static tier.
 */
export default function VaultScene({ tier, onReady, onFloor }: VaultSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vaultRef = useRef<VaultRenderer | null>(null);
  const tierRef = useRef(tier);
  const readyRef = useRef(onReady);
  const floorRef = useRef(onFloor);

  useEffect(() => {
    readyRef.current = onReady;
    floorRef.current = onFloor;
  }, [onReady, onFloor]);

  // Tier changes (lite after a slow probe) adjust DPR and particle count in place.
  useEffect(() => {
    tierRef.current = tier;
    const v = vaultRef.current;
    if (!v) return;
    const s = tierSettings(tier, window.devicePixelRatio);
    v.setDpr(s.dprCap);
    v.setParticles(s.particles);
  }, [tier]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // A fresh canvas per mount: a context lost on unmount (StrictMode remounts, tier changes) is never reused.
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    wrap.appendChild(canvas);
    const s = tierSettings(tierRef.current, window.devicePixelRatio);
    let vault: VaultRenderer;
    try {
      vault = createVaultRenderer({ canvas, dpr: s.dprCap, particles: s.particles });
    } catch {
      canvas.remove();
      floorRef.current?.("static"); // no WebGL: keep the poster
      return;
    }
    vaultRef.current = vault;
    wrap.dataset.mountedTier = tierRef.current;

    const resize = () => vault.resize(wrap.clientWidth, wrap.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = 0;
    let t = 0;
    let frames = 0;
    let probed = false;
    const deltas: number[] = [];
    let onScreen = true;
    let announced = false;

    const loop = (now: number) => {
      const dtMs = last ? now - last : 16.7;
      last = now;
      t += Math.min(dtMs / 1000, MAX_DT);
      const cam = vault.frame(t, getVaultCameraTarget(), Math.min(dtMs / 1000, MAX_DT));
      publishVaultCamera(cam);
      if (!announced) {
        announced = true;
        readyRef.current();
      }
      if (!probed) {
        frames += 1;
        if (frames > FPS_WARMUP_FRAMES) deltas.push(dtMs);
        if (deltas.length >= FPS_PROBE_FRAMES) {
          probed = true;
          const verdict = fpsVerdict(deltas, tierRef.current);
          wrap.dataset.probedFps = String(Math.round(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)));
          if (verdict !== tierRef.current) {
            if (verdict === "lite") reportLowFps();
            floorRef.current?.(verdict);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf || !onScreen || document.hidden) return;
      last = 0;
      // A paused probe would measure the pause; restart it.
      if (!probed) {
        frames = 0;
        deltas.length = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
      wrap.dataset.running = String(onScreen && !document.hidden);
      if (onScreen) start();
      else stop();
    });
    io.observe(wrap);
    const onVisibility = () => {
      wrap.dataset.running = String(onScreen && !document.hidden);
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      publishVaultCamera(vault.keys[0]!);
      resetVaultCamera();
      vault.destroy();
      canvas.remove();
      vaultRef.current = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0" data-testid="vault-canvas" data-running="true" />
  );
}
