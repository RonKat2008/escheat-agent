"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RenderTier } from "./render-tier";
import { useInViewport } from "./useInViewport";
import { useRenderTier } from "./useRenderTier";

export interface CanvasSceneProps {
  tier: RenderTier;
  onReady: () => void;
}

export interface LazyCanvasProps {
  /**
   * `alt` is the short name of the scene. Put long prose in `description`: it is rendered visually hidden and wired
   * with aria-describedby, so it can never paint (a broken or loading image would otherwise draw its alt text).
   */
  poster: { src: string; alt: string; width: number; height: number; description?: string };
  load: () => Promise<{ default: ComponentType<CanvasSceneProps> }>;
  /** DOM labels drawn over both poster and canvas. */
  overlay?: ReactNode;
  className?: string;
  tier?: RenderTier;
}

const IDLE_TIMEOUT_MS = 2000;
const CROSSFADE_MS = 400;

function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(cb, IDLE_TIMEOUT_MS);
  return () => window.clearTimeout(id);
}

/** Poster first; the heavy scene loads when idle, in view and tier allows, then crossfades in. */
export function LazyCanvas({ poster, load, overlay, className, tier: tierProp }: LazyCanvasProps) {
  const detected = useRenderTier();
  const tier = tierProp ?? detected;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref);
  const [idle, setIdle] = useState(false);
  const [Scene, setScene] = useState<ComponentType<CanvasSceneProps> | null>(null);
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const descId = useId();
  const description = poster.description;

  useEffect(() => whenIdle(() => setIdle(true)), []);

  const shouldLoad = idle && inView && tier !== "static";
  useEffect(() => {
    if (!shouldLoad || started.current) return;
    started.current = true;
    let cancelled = false;
    load()
      .then((mod) => {
        if (!cancelled) setScene(() => mod.default);
      })
      .catch(() => {
        started.current = false; // allow retry on the next visibility change
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoad, load]);

  // Static tier shows only the poster, even if a scene was loaded earlier.
  const showScene = Scene !== null && tier !== "static";

  return (
    <div
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      data-tier={tier}
      {...(description ? { role: "img", "aria-label": poster.alt, "aria-describedby": descId } : {})}
    >
      {description ? (
        <span id={descId} className="sr-only">
          {description}
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster.src}
        alt={description ? "" : poster.alt}
        width={poster.width}
        height={poster.height}
        fetchPriority="high"
        decoding="async"
        className="block h-full w-full object-cover"
      />
      {showScene ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 transition-opacity ease-out"
          style={{ opacity: ready ? 1 : 0, transitionDuration: `${CROSSFADE_MS}ms` }}
        >
          <Scene tier={tier} onReady={() => setReady(true)} />
        </div>
      ) : null}
      {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
    </div>
  );
}
