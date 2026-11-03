"use client";

import { useEffect, useState } from "react";
import type { Rect, Size } from "./geometry";
import { cleanReadout, type TourReadout } from "./steps";

export type AnchorPhase = "searching" | "ready" | "missing";

export interface AnchorState {
  phase: AnchorPhase;
  rect: Rect | null;
  vp: Size;
  readouts: { label: string; value: string }[];
  /** Bumps every time a new target is found, so the overlay can re-focus its dialog. */
  foundKey: number;
}

const POLL_MS = 150;
/** How long to look for a stop's anchor before saying it is not on screen (dev servers compile routes slowly). */
const GIVE_UP_MS = 25_000;
/** After a lower-priority anchor appears, keep looking this long for a better one (the drawer before its lifecycle). */
const UPGRADE_MS = 3_000;
const READOUT_MS = 1_000;
const HEADER_OFFSET = 64;

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
}

function findBest(selectors: readonly string[]): { el: Element; rank: number } | null {
  for (const [i, sel] of selectors.entries()) {
    let found: Element | null = null;
    try {
      found = Array.from(document.querySelectorAll(sel)).find(visible) ?? null;
    } catch {
      found = null; // an invalid selector is skipped, never fatal
    }
    if (found) return { el: found, rank: i };
  }
  return null;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Bring the target into view: centered when it fits, otherwise its top just under the sticky header (also in a
 * drawer, so the spotlight, which never starts above the header line, always frames it).
 */
function reveal(el: Element) {
  const r = el.getBoundingClientRect();
  // Phones: the narration sheet covers the lower half, so targets always go to the top.
  const top = r.height > window.innerHeight * 0.55 || window.innerWidth < 640;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  const y = top ? r.top - HEADER_OFFSET : r.top + r.height / 2 - window.innerHeight / 2;
  if (Math.abs(y) <= 2) return;
  // A target in its own scroller (a drawer) scrolls that scroller by the same offset; otherwise the window does.
  const inner = scrollParent(el);
  if (inner) inner.scrollBy({ top: y, behavior });
  else window.scrollTo({ top: Math.max(0, window.scrollY + y), behavior });
}

function readAll(readouts: readonly TourReadout[] | undefined): { label: string; value: string }[] {
  if (!readouts) return [];
  const out: { label: string; value: string }[] = [];
  for (const r of readouts) {
    for (const sel of r.selectors) {
      const el = document.querySelector(sel);
      const value = el instanceof HTMLElement ? cleanReadout(el.innerText) : null;
      if (value) {
        out.push({ label: r.label, value });
        break;
      }
    }
  }
  return out;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

const viewport = (): Size => (typeof window === "undefined" ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight });

/**
 * Finds the stop's anchor on the real page (polling, since routes stream in), keeps its viewport rect current while it
 * moves (scroll, resize, streaming content), and reads the stop's readouts off the page. `key` changes per stop and
 * per navigation; `enabled` is false while the overlay is still navigating.
 */
export function useTourAnchor(key: string, enabled: boolean, anchors: readonly string[], readouts: readonly TourReadout[] | undefined): AnchorState {
  const [state, setState] = useState<AnchorState>(() => ({ phase: "searching", rect: null, vp: viewport(), readouts: [], foundKey: 0 }));

  useEffect(() => {
    if (!enabled) return;
    let target: Element | null = null;
    let rank = Number.POSITIVE_INFINITY;
    let frame = 0;
    const started = performance.now();
    let firstFound = 0;

    const track = () => {
      const el = target;
      if (el) {
        const b = el.getBoundingClientRect();
        const rect = { x: b.x, y: b.y, w: b.width, h: b.height };
        const vp = viewport();
        setState((s) => (sameRect(s.rect, rect) && s.vp.w === vp.w && s.vp.h === vp.h ? s : { ...s, rect, vp }));
      }
      frame = requestAnimationFrame(track);
    };

    const poll = () => {
      const best = findBest(anchors);
      const now = performance.now();
      if (best && best.rank < rank && best.el !== target) {
        target = best.el;
        rank = best.rank;
        if (!firstFound) firstFound = now;
        reveal(best.el);
        setState((s) => ({ ...s, phase: "ready", readouts: readAll(readouts), foundKey: s.foundKey + 1 }));
      } else if (target && !target.isConnected) {
        target = null;
        rank = Number.POSITIVE_INFINITY;
        firstFound = 0;
      }
      if (!target && now - started > GIVE_UP_MS) {
        setState((s) => ({ ...s, phase: "missing", rect: null, readouts: readAll(readouts) }));
        return;
      }
      const settled = target && (rank === 0 || now - firstFound > UPGRADE_MS);
      if (!settled) timer = window.setTimeout(poll, POLL_MS);
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new stop starts from "searching"
    setState((s) => ({ ...s, phase: "searching", rect: null, readouts: [] }));
    let timer = window.setTimeout(poll, 0);
    frame = requestAnimationFrame(track);
    const readTimer = window.setInterval(() => {
      if (!target) return;
      const next = readAll(readouts);
      setState((s) => (JSON.stringify(s.readouts) === JSON.stringify(next) ? s : { ...s, readouts: next }));
    }, READOUT_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(readTimer);
      cancelAnimationFrame(frame);
    };
    // `anchors`/`readouts` are static per stop; `key` identifies the stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
