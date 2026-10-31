"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bolt } from "./Bolt";

/**
 * Hero visual: one synthetic stale check moving through the pipeline while the agent trace writes itself.
 * Purely illustrative (labelled as such). With prefers-reduced-motion it shows the finished state and never animates.
 */

const LAST_STEP = 5;
const STEP_MS = 1500;
const HOLD_MS = 4200;

interface TraceLine {
  at: number;
  who: string;
  text: string;
  human?: boolean;
}

const TRACE: readonly TraceLine[] = [
  { at: 1, who: "ledger", text: "check #10482 issued 14 months ago, no bank clear" },
  { at: 1, who: "detect", text: "past the 180-day stale threshold" },
  { at: 2, who: "rules", text: "CA vendor check: dates from rules/CA.json, sources attached" },
  { at: 2, who: "letter", text: "due-diligence letter drafted from statutory text" },
  { at: 3, who: "approval", text: "waiting for a person to approve this exact payload", human: true },
  { at: 4, who: "approval", text: "approved. payload hash matches", human: true },
  { at: 4, who: "lob", text: "certified letter created in TEST mode" },
  { at: 5, who: "owner", text: "owner responded, check reissued" },
];

const STATUS: readonly { label: string; human?: boolean }[] = [
  { label: "Outstanding" },
  { label: "Stale" },
  { label: "Stale, rules applied" },
  { label: "Awaiting your approval", human: true },
  { label: "Letter sent (test mode)" },
  { label: "Owner paid" },
];

const RAIL = ["Issued", "Stale", "Letter", "Resolved"] as const;
const RAIL_ACTIVE_AT = [0, 1, 4, 5] as const;
const FILL_BY_STEP = [0, 1 / 3, 1 / 3, 1 / 3, 2 / 3, 1] as const;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function HeroTrace() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
  const [animStep, setAnimStep] = useState(0);
  const step = reduced ? LAST_STEP : animStep;

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const advance = (current: number) => {
      const next = current >= LAST_STEP ? 0 : current + 1;
      timer = setTimeout(
        () => {
          setAnimStep(next);
          advance(next);
        },
        current >= LAST_STEP ? HOLD_MS : STEP_MS,
      );
    };
    timer = setTimeout(() => {
      setAnimStep(1);
      advance(1);
    }, 900);
    return () => clearTimeout(timer);
  }, [reduced]);

  const status = STATUS[step] ?? STATUS[0]!;
  const waiting = step === 3;

  return (
    <figure className="mkt-trace mkt-rise" style={{ "--d": 300 } as React.CSSProperties} aria-label="Illustrative run of one synthetic check through Escheat Agent">
      <p className="mkt-sr">
        Illustration: a synthetic uncashed check is detected as stale, the agent applies the state rules and drafts a due-diligence letter, a person
        approves it, the letter goes out in test mode and the owner responds.
      </p>
      <div aria-hidden>
        <div className="mkt-trace-head">
          <span className="mkt-trace-title">
            <Bolt /> Case file
          </span>
          <span className="mkt-trace-synth">Synthetic example</span>
        </div>

        <div className="mkt-check">
          <div className="mkt-check-row">
            <span className="mkt-check-no">No. 10482</span>
            <span className="mkt-check-date">Issued 14 months ago</span>
          </div>
          <div className="mkt-check-pay">
            <span className="mkt-check-label">Pay to the order of</span>
            <span className="mkt-check-payee">Bayline Electric</span>
          </div>
          <div className="mkt-check-amount">$2,340.00</div>
          <span className={`mkt-chip ${status.human ? "mkt-chip-human" : "mkt-chip-agent"}`} data-pulse={waiting}>
            {status.label}
          </span>
        </div>

        <div className="mkt-rail">
          <div className="mkt-rail-line">
            <div className="mkt-rail-fill" style={{ transform: `scaleX(${FILL_BY_STEP[step] ?? 0})` }} />
          </div>
          <ol className="mkt-rail-nodes">
            {RAIL.map((label, i) => (
              <li key={label} data-on={step >= (RAIL_ACTIVE_AT[i] ?? LAST_STEP)} data-wait={i === 2 && waiting}>
                <span className="mkt-rail-dot" />
                {label}
              </li>
            ))}
          </ol>
        </div>

        <ul className="mkt-log">
          {TRACE.map((l, i) => (
            <li key={i} data-on={step >= l.at} data-human={l.human ? "true" : "false"}>
              <span className="mkt-log-who">{l.who}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
