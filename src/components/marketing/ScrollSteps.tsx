"use client";

import { motion, useScroll } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { STEPS } from "./steps";

/**
 * Scroll-linked walkthrough: a sticky numeral tracks the step in view and a blue line fills as you scroll the list.
 * The fill is a compositor-only scaleY. With prefers-reduced-motion the CSS shows every step at full strength.
 */
export function ScrollSteps() {
  const listRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 55%", "end 55%"] });

  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("li");
    if (!items || items.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const current = STEPS[active] ?? STEPS[0]!;

  return (
    <div className="mkt-scrolly">
      <div className="mkt-scrolly-aside" aria-hidden>
        <div className="mkt-scrolly-sticky">
          <span key={active} className="mkt-bignum" data-actor={current.actor}>
            {active + 1}
          </span>
          <span className="mkt-scrolly-of">of {STEPS.length}</span>
          <span className={`mkt-chip ${current.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>{current.actorNote}</span>
        </div>
      </div>
      <div className="mkt-scrolly-main">
        <div className="mkt-scrolly-track" aria-hidden>
          <motion.div className="mkt-scrolly-fill" style={{ scaleY: scrollYProgress }} />
        </div>
        <ol ref={listRef} className="mkt-scrolly-list">
          {STEPS.map((s, i) => (
            <li key={s.id} data-i={i} data-active={i === active} data-actor={s.actor}>
              <h3 className="mkt-display">{s.title}</h3>
              <p>{s.short}</p>
              <span className={`mkt-chip ${s.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>{s.actorNote}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
