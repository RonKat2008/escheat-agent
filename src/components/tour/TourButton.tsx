import Link from "next/link";
import { Compass } from "lucide-react";
import { TOUR_START_HREF } from "./tour-url";
import { ROUND_BUTTON } from "@/components/shell/chrome";

/** Small top-bar entry to the Judge tour. A plain link: the tour is URL state (`?tour=1`), so it works before hydration. */
export function TourButton() {
  return (
    <Link
      href={TOUR_START_HREF}
      prefetch={false}
      aria-label="Take the 3-minute tour"
      title="Take the 3-minute tour"
      data-testid="tour-start"
      className={ROUND_BUTTON}
    >
      <Compass className="size-4 text-blue-300" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}
