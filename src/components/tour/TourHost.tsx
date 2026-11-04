"use client";

import { useEffect, useState, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseTourParam, TOUR_PARAM, withoutTourParam } from "./tour-url";

type OverlayComponent = ComponentType<{ requested: number }>;

/** Large enough for any real tour; the overlay clamps to its own stop count. Keeps the stop list out of this chunk. */
const ANY_LENGTH = 9999;

const loadOverlay = () => import("./TourOverlay").then((m) => m.default as OverlayComponent);

/**
 * Judge tour host, mounted once in the app shell (inside Suspense: it reads the URL). The URL is the tour's only
 * state: `?tour=N` opens stop N, removing it closes the tour, so a refresh or a shared link resumes in place. The
 * overlay (spotlight, popover, stop list) is a separate chunk loaded only when a tour is actually open, so no route
 * bundle pays for it.
 */
export function TourHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get(TOUR_PARAM);
  const requested = parseTourParam(raw, ANY_LENGTH);
  const [Overlay, setOverlay] = useState<OverlayComponent | null>(null);
  const open = requested !== null;
  const search = params.toString();

  // A `?tour=` value that is not a stop (`?tour=abc`) opens nothing; drop it so the URL does not claim a tour.
  useEffect(() => {
    if (raw !== null && requested === null) router.replace(`${pathname}${withoutTourParam(search)}`, { scroll: false });
  }, [raw, requested, pathname, search, router]);

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

  return open && Overlay ? <Overlay requested={requested} /> : null;
}
