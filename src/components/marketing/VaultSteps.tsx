"use client";

import { useEffect, useRef, useState } from "react";
import { stepsToCamera } from "@/components/viz/vault-scene/scene-math";
import { setVaultCameraTarget } from "@/components/viz/vault-scene/vault-store";
import { LANDING_STEPS } from "./steps";

/** Progress starts when the list's top reaches 70% of the viewport and ends when its bottom reaches 60%. */
const START_AT = 0.7;
const END_AT = 0.6;

function listProgress(rect: DOMRect, viewport: number): number {
  const start = viewport * START_AT;
  const span = rect.height + start - viewport * END_AT;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (start - rect.top) / span));
}

/**
 * "How it works" in four steps. Scrolling the list moves The Vault's camera through its four keyframes (a passive,
 * rAF-throttled scroll listener -> the scene's camera target; motion's useScroll pulled ~15 KB gz into the landing's
 * initial JS); the step nearest the viewport centre is marked active. The list is plain, readable content with or
 * without JS and under reduced motion.
 */
export function VaultSteps() {
  const listRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setVaultCameraTarget(stepsToCamera(listProgress(list.getBoundingClientRect(), window.innerHeight)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-step]");
    if (!items?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      setVaultCameraTarget(0);
    };
  }, []);

  return (
    <ol ref={listRef} className="vx-steps" aria-label="How it works, in four steps">
      {LANDING_STEPS.map((s, i) => (
        <li key={s.id} data-step={i} data-active={i === active} data-actor={s.actor} className="vx-step">
          <p className="vx-step-meta">
            <span className="vx-step-n">{String(i + 1).padStart(2, "0")}</span>
            <span className={`mkt-chip ${s.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>
              <span aria-hidden className="mkt-chip-shape" />
              {s.actorNote}
            </span>
          </p>
          <h3>{s.title}</h3>
          <p className="vx-step-body">{s.body}</p>
          <p className="vx-step-proof">
            <span className="mkt-label">Left behind</span> {s.leaves}
          </p>
        </li>
      ))}
    </ol>
  );
}
