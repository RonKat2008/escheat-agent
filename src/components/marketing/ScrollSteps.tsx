"use client";

import { motion, useScroll } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STEPS } from "./steps";

const subscribeNothing = () => () => {};

/**
 * Scroll-linked walkthrough. The list is the content and always readable; on wide screens a sticky "case file note"
 * beside it swaps to the evidence the step in view leaves behind, and a blue line fills as you move down.
 * Without JS every step shows its evidence inline. Under prefers-reduced-motion nothing fades or slides.
 */
export function ScrollSteps() {
  const listRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const enhanced = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 60%", "end 60%"] });

  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("li");
    if (!items || items.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const current = STEPS[active] ?? STEPS[0]!;
  const human = current.actor === "you";

  return (
    <div className="mkt-scrolly" data-enhanced={enhanced}>
      <aside className="mkt-scrolly-aside" aria-hidden>
        <div className="mkt-note" data-actor={current.actor}>
          <p className="mkt-note-count">
            Step {active + 1} of {STEPS.length}
          </p>
          <div key={active} className="mkt-note-body">
            <span className={`mkt-chip ${human ? "mkt-chip-human" : "mkt-chip-agent"}`}>{current.actorNote}</span>
            <h4>Left behind</h4>
            <p>{current.leaves}</p>
            <h4>Stays with you</h4>
            <p>{current.stays}</p>
          </div>
          <div className="mkt-note-ticks">
            {STEPS.map((s, i) => (
              <span key={s.id} data-on={i <= active} data-actor={s.actor} />
            ))}
          </div>
        </div>
      </aside>
      <div className="mkt-scrolly-main">
        <div className="mkt-scrolly-track" aria-hidden>
          <motion.div className="mkt-scrolly-fill" style={{ scaleY: scrollYProgress }} />
        </div>
        <ol ref={listRef} className="mkt-scrolly-list">
          {STEPS.map((s, i) => (
            <li key={s.id} data-i={i} data-active={i === active} data-actor={s.actor}>
              <span className="mkt-step-idx">{i + 1}</span>
              <h3 className="mkt-display">{s.title}</h3>
              <p>{s.short}</p>
              <span className={`mkt-chip ${s.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>{s.actorNote}</span>
              <dl className="mkt-step-evidence">
                <div>
                  <dt>Left behind</dt>
                  <dd>{s.leaves}</dd>
                </div>
                <div>
                  <dt>Stays with you</dt>
                  <dd>{s.stays}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
