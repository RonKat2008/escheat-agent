import { CalendarPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** /api/calendar.ics with the same filters as the page (omitted when they are the defaults). */
export function calendarHref(opts: { state?: string | null; horizon?: number | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.state) q.set("state", opts.state);
  if (opts.horizon) q.set("horizon", String(opts.horizon));
  const s = q.toString();
  return `/api/calendar.ics${s ? `?${s}` : ""}`;
}

/**
 * Downloads the RFC 5545 feed of report/remit due dates and due-diligence window openings. A plain link (no JS):
 * calendar apps import the file, and the passcode session cookie travels with the same-origin request.
 */
export function AddToCalendar({
  state,
  horizon,
  size = "default",
  className,
}: {
  state?: string | null;
  horizon?: number | null;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <a
      href={calendarHref({ state, horizon })}
      download="escheat-deadlines.ics"
      data-testid="add-to-calendar"
      className={cn(buttonVariants({ variant: "outline", size }), className)}
    >
      <CalendarPlus strokeWidth={1.5} aria-hidden />
      Add to calendar
    </a>
  );
}
