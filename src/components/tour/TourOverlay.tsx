"use client";

import "./tour.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { searchItemsAction } from "@/components/shell/actions";
import { holePolygon, placePopover, ringPolygon, spotRect, type Size } from "./geometry";
import { atStep, clampIndex, nextIndex, prevIndex, stepAt, stepHref, TOUR_TOTAL, type TourStep } from "./steps";
import { TourPopover } from "./TourPopover";
import { withoutTourParam } from "./tour-url";
import { useTourAnchor } from "./useTourAnchor";

/** Below this width the narration is a bottom sheet instead of an anchored popover. */
const SHEET_MAX_W = 640;
/** Keep the spotlight below the sticky 48px top bar, so the hole never frames the header instead of the target. */
const TOP_INSET = 52;
const ROOT_ID = "judge-tour-root";
/** Attributes other modals put on "everything else" (aria-hidden/inert); the tour must stay reachable above them. */
const HIDING_ATTRS = ["aria-hidden", "inert", "data-base-ui-inert"];

type Resolved = Record<string, string>;

/** The stop's runtime query: for the check stop, the real item id behind the check number (or a search fallback). */
async function resolveQuery(step: TourStep): Promise<Resolved> {
  if (!step.resolve) return {};
  const n = step.resolve.checkNumber;
  try {
    const hits = await searchItemsAction(n);
    const hit = hits.find((h) => h.checkNumber === n);
    return hit ? { item: hit.id } : { q: n };
  } catch {
    return { q: n };
  }
}

/** A body-level container that other dialogs cannot hide from assistive tech while the tour is open. */
function usePortalRoot(): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.id = ROOT_ID;
    document.body.appendChild(el);
    const unhide = () => HIDING_ATTRS.forEach((a) => el.hasAttribute(a) && el.removeAttribute(a));
    const mo = new MutationObserver(unhide);
    mo.observe(el, { attributes: true, attributeFilter: HIDING_ATTRS });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the container exists only in the browser
    setRoot(el);
    return () => {
      mo.disconnect();
      el.remove();
    };
  }, []);
  return root;
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * The Judge tour (lazy chunk, loaded by TourHost only when `?tour=N` is in the URL). It navigates to each stop's real
 * screen, spotlights the part that matters, narrates it in one line and reads any figure off the page itself. It never
 * clicks anything for the judge: Approve, Send and Submit stay a person's click, which the server enforces anyway.
 */
export default function TourOverlay({ requested }: { requested: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const index = clampIndex(requested, TOUR_TOTAL);
  const step = stepAt(index);
  const here = atStep(step, pathname, search);
  const root = usePortalRoot();
  const vw = useViewportWidth();
  const sheet = vw < SHEET_MAX_W;
  const popRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const resolvedCache = useRef(new Map<string, Resolved>());
  const navigating = useRef<string | null>(null);
  const [pop, setPop] = useState<Size>({ w: 380, h: 240 });
  const anchor = useTourAnchor(`${step.id}:${pathname}?${search}`, here, step.anchors, step.readouts, step.loaded);
  // Which stop's invite the judge pressed (so it resets on every other stop without an effect).
  const [invitedStep, setInvitedStep] = useState<string | null>(null);

  /** The judge pressed the tour's invite button: press the page's own button once, exactly as a click on it would. */
  const invite = useCallback(() => {
    const target = step.invite ? document.querySelector(step.invite.target) : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    target.click();
    setInvitedStep(step.id);
    primaryRef.current?.focus({ preventScroll: true });
  }, [step]);

  const hrefFor = useCallback(async (i: number) => {
    const s = stepAt(i);
    let q = resolvedCache.current.get(s.id);
    if (!q) {
      q = await resolveQuery(s);
      resolvedCache.current.set(s.id, q);
    }
    return stepHref(s, i, q);
  }, []);

  const go = useCallback(
    async (i: number, mode: "push" | "replace" = "push") => {
      const href = await hrefFor(i);
      if (navigating.current === href) return;
      navigating.current = href;
      const samePage = href.split("?")[0] === window.location.pathname;
      if (mode === "replace") router.replace(href, { scroll: !samePage });
      else router.push(href, { scroll: !samePage });
    },
    [hrefFor, router],
  );

  const close = useCallback(() => {
    router.replace(`${window.location.pathname}${withoutTourParam(window.location.search)}`, { scroll: false });
    const back = returnFocus.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }, [router]);

  const next = useCallback(() => {
    const n = nextIndex(index);
    if (n === null) close();
    else void go(n);
  }, [index, go, close]);
  const prev = useCallback(() => {
    const p = prevIndex(index);
    if (p !== null) void go(p);
  }, [index, go]);

  // Resume from a URL that names a stop but not its screen (a shared `?tour=N`, or a refresh mid-tour).
  useEffect(() => {
    if (here) navigating.current = null;
    else void go(index, "replace");
  }, [here, index, go]);

  // Remember where focus was, to give it back on close.
  useEffect(() => {
    returnFocus.current = document.activeElement;
  }, []);

  // Keep focus in the tour when a stop is reached (a drawer that opens on navigation grabs it first).
  useEffect(() => {
    const p = popRef.current;
    if (!p) return;
    if (!p.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true });
  }, [anchor.foundKey, anchor.phase, root]);

  // →/← move, Esc closes. Capture phase, so a page's own Escape (a drawer) does not also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const inTour = Boolean(t && popRef.current?.contains(t));
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing && !inTour) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, next, prev]);

  // Popover size for collision handling.
  useEffect(() => {
    const p = popRef.current;
    if (!p) return;
    const ro = new ResizeObserver(() => {
      const b = p.getBoundingClientRect();
      setPop((s) => (Math.abs(s.w - b.width) < 1 && Math.abs(s.h - b.height) < 1 ? s : { w: b.width, h: b.height }));
    });
    ro.observe(p);
    return () => ro.disconnect();
  }, [root, sheet]);

  if (!root) return null;

  // On phones the sheet covers the bottom of the screen: the spotlight stops above it.
  const spotVp = sheet ? { w: anchor.vp.w, h: Math.max(TOP_INSET + 40, anchor.vp.h - pop.h) } : anchor.vp;
  const spot = anchor.phase === "ready" && anchor.rect ? spotRect(anchor.rect, spotVp, 8, 4, TOP_INSET) : null;
  const full = { x: 0, y: 0, w: anchor.vp.w, h: anchor.vp.h };
  const place = sheet ? null : placePopover(spot, pop, anchor.vp);
  const human = Boolean(step.human);

  return createPortal(
    <div className="judge-tour" data-testid="judge-tour" data-step={step.id} data-index={index + 1} data-phase={anchor.phase} data-layout={sheet ? "sheet" : "popover"}>
      <div aria-hidden className="judge-tour-backdrop" style={{ clipPath: holePolygon(full, spot) }} data-testid="tour-backdrop" />
      <div aria-hidden className="judge-tour-ring" data-human={human ? "true" : "false"} data-on={spot ? "true" : "false"} style={{ clipPath: ringPolygon(spot) }} data-testid="tour-ring" />
      <TourPopover
        ref={popRef}
        primaryRef={primaryRef}
        step={step}
        index={index}
        total={TOUR_TOTAL}
        phase={anchor.phase}
        readouts={anchor.readouts}
        invited={invitedStep === step.id}
        onInvite={invite}
        sheet={sheet}
        style={place ? { transform: `translate3d(${Math.round(place.x)}px, ${Math.round(place.y)}px, 0)` } : undefined}
        side={place?.side ?? "sheet"}
        onNext={next}
        onPrev={prev}
        onClose={close}
        onJump={(i) => void go(i)}
      />
    </div>,
    root,
  );
}
