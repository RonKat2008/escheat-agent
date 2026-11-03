import Link from "next/link";
import { Compass } from "lucide-react";
import { TOUR_START_HREF } from "./tour-url";

/** Small top-bar entry to the Judge tour. A plain link: the tour is URL state (`?tour=1`), so it works before hydration. */
export function TourButton() {
  return (
    <Link
      href={TOUR_START_HREF}
      prefetch={false}
      aria-label="Take the 3-minute tour"
      title="Take the 3-minute tour"
      data-testid="tour-start"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 text-[13px] text-fg-2 transition-colors duration-150 hover:border-blue-500 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    >
      <Compass className="size-3.5 text-blue-400" strokeWidth={1.75} aria-hidden />
      <span className="hidden xl:inline">Tour</span>
    </Link>
  );
}
