"use client";

import { useCallback, useState, type ComponentType } from "react";
import { LazyCanvas, type CanvasSceneProps } from "@/components/viz/core/LazyCanvas";
import { minTier, type RenderTier } from "@/components/viz/core/render-tier";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VaultLabels } from "@/components/viz/vault-scene/VaultLabels";

export const VAULT_POSTER = { src: "/marketing/vault-poster.avif", width: 1600, height: 1000 } as const;

const POSTER_ALT = "The Vault";
const POSTER_DESCRIPTION =
  "The Vault: 733 synthetic ledger items lie as slabs on a dark floor grid. 47 stale items lift and send threads of blue light toward three pylons labelled CA, TX and DE. Each thread stops at a ring that glows pink, where a person must approve, before it continues.";

/**
 * The landing centerpiece: the AVIF poster paints first (LCP), the OGL scene loads after idle when in view and the
 * tier allows, then crossfades in. An FPS probe inside the scene can lower the tier (lite, or back to the poster).
 */
export function HeroVault() {
  const detected = useRenderTier();
  const [floor, setFloor] = useState<RenderTier>("full");
  const tier = minTier(detected, floor);

  const load = useCallback(
    () =>
      import("@/components/viz/vault-scene/VaultScene").then((mod) => {
        const Scene = mod.default;
        const Bound: ComponentType<CanvasSceneProps> = (p) => <Scene {...p} onFloor={(t) => setFloor((f) => minTier(f, t))} />;
        return { default: Bound };
      }),
    [],
  );

  return (
    <figure className="vault-stage" data-testid="hero-vault">
      <LazyCanvas poster={{ ...VAULT_POSTER, alt: POSTER_ALT, description: POSTER_DESCRIPTION }} load={load} tier={tier} overlay={<VaultLabels />} className="vault-frame" />
      <figcaption className="sr-only">
        Illustration of the agent at work on synthetic data. Ledger items flow as light toward California, Texas and Delaware, and pause at a pink
        approval gate until a person signs off. A reverse thread returns recovered money.
      </figcaption>
    </figure>
  );
}
