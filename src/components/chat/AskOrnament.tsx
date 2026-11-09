"use client";

import { useCallback, useState, useSyncExternalStore, type ComponentType } from "react";
import { VAULT_POSTER } from "@/components/marketing/HeroVault";
import { LazyCanvas, type CanvasSceneProps } from "@/components/viz/core/LazyCanvas";
import { minTier, type RenderTier } from "@/components/viz/core/render-tier";
import { useRenderTier } from "@/components/viz/core/useRenderTier";

/** The ornament exists only on wide screens; nothing of it (not even the poster request) happens below 1024px. */
const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(cb: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isWide = () => window.matchMedia(WIDE_QUERY).matches;
const serverWide = () => false;

/**
 * The vault scene as a soft, decorative ornament behind the Ask headline (docs/ASK-MODE.md §4), at ≥1024px only.
 * It reuses the landing's lazy pipeline: the AVIF poster paints first, the OGL canvas loads only after idle, in view and
 * at tier `full` or `lite`, and the scene's FPS probe can drop it back to the poster. Under reduced motion, save-data or
 * the app's motion setting the tier is `static`: poster only, never a canvas. It is `aria-hidden` and sits under the
 * text at 40% opacity. AskHero renders only before the first message, so sending one unmounts it (and the scene
 * disposes its renderer on unmount).
 */
export function AskOrnament() {
  const wide = useSyncExternalStore(subscribeWide, isWide, serverWide);
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

  if (!wide) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="ask-ornament"
      className="ask-ornament pointer-events-none absolute top-1/2 -left-[8%] z-0 aspect-[16/10] w-[min(760px,62%)] -translate-y-[58%] opacity-40 select-none"
    >
      <LazyCanvas poster={{ ...VAULT_POSTER, alt: "" }} load={load} tier={tier} className="h-full w-full" />
    </div>
  );
}
