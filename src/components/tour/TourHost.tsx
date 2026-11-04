"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { markFirstRun, readFirstRun, shouldWelcome, type FirstRunChoice } from "./first-run";
import { parseTourParam, TOUR_PARAM, TOUR_START_HREF, withoutTourParam } from "./tour-url";

type OverlayComponent = ComponentType<{ requested: number }>;
type WelcomeComponent = ComponentType<{ onTour: () => void; onSkip: () => void }>;

/** Large enough for any real tour; the overlay clamps to its own stop count. Keeps the stop list out of this chunk. */
const ANY_LENGTH = 9999;

const loadOverlay = () => import("./TourOverlay").then((m) => m.default as OverlayComponent);
const loadWelcome = () => import("./WelcomeSheet").then((m) => m.default as WelcomeComponent);

/** Answered on this page even when storage refused to remember it (private window): never asked twice per load. */
let answeredThisPage = false;

/**
 * Tour host, mounted once in the app shell (inside Suspense: it reads the URL). The URL is the tour's only state:
 * `?tour=N` opens stop N, removing it closes the tour, so a refresh or a shared link resumes in place. On a first
 * visit (nothing remembered in localStorage) it offers the welcome sheet instead. The overlay and the welcome are
 * separate chunks loaded only when needed, so no route bundle pays for them.
 */
export function TourHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get(TOUR_PARAM);
  const requested = parseTourParam(raw, ANY_LENGTH);
  const [Overlay, setOverlay] = useState<OverlayComponent | null>(null);
  const [Welcome, setWelcome] = useState<WelcomeComponent | null>(null);
  const [welcoming, setWelcoming] = useState(false);
  const open = requested !== null;
  const search = params.toString();

  // A `?tour=` value that is not a stop (`?tour=abc`) opens nothing; drop it so the URL does not claim a tour.
  useEffect(() => {
    if (raw !== null && requested === null) router.replace(`${pathname}${withoutTourParam(search)}`, { scroll: false });
  }, [raw, requested, pathname, search, router]);

  // First visit: offer the welcome (client only, so server and client render the same). Opening a tour by any other
  // route (Tour button, ⌘K, a shared link) also counts as the answer.
  useEffect(() => {
    if (open) {
      if (readFirstRun() === null) markFirstRun("toured");
      answeredThisPage = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the tour replaces the welcome
      setWelcoming(false);
      return;
    }
    if (answeredThisPage || !shouldWelcome(readFirstRun(), open)) return;
    setWelcoming(true);
  }, [open]);

  useEffect(() => {
    if (!welcoming || Welcome) return;
    let live = true;
    loadWelcome()
      .then((C) => live && setWelcome(() => C))
      .catch(() => undefined); // no welcome is better than a broken page; the Tour button still works
    return () => {
      live = false;
    };
  }, [welcoming, Welcome]);

  useEffect(() => {
    if (!open || Overlay) return;
    let live = true;
    loadOverlay()
      .then((C) => live && setOverlay(() => C))
      .catch(() => undefined); // a failed chunk load retries on the next URL change
    return () => {
      live = false;
    };
  }, [open, Overlay]);

  const answer = useCallback(
    (choice: FirstRunChoice) => {
      markFirstRun(choice);
      answeredThisPage = true;
      setWelcoming(false);
      if (choice === "toured") router.push(TOUR_START_HREF);
    },
    [router],
  );
  const onTour = useCallback(() => answer("toured"), [answer]);
  const onSkip = useCallback(() => answer("skipped"), [answer]);

  if (open) return Overlay ? <Overlay requested={requested} /> : null;
  return welcoming && Welcome ? <Welcome onTour={onTour} onSkip={onSkip} /> : null;
}
