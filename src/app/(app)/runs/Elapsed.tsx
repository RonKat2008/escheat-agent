"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/components/b/trace";

/** Live elapsed time for a running run, ticking once a second from its recorded start. */
export function Elapsed({ since }: { since: string }) {
  // Null until mounted, so server and client render the same text; then it ticks every second.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (now === null) return <span className="text-blue-300">Live</span>;
  const ms = Math.max(0, now - Date.parse(since));
  return (
    <span className="num text-blue-300" data-testid="run-elapsed">
      {formatDuration(ms)}
      <span className="sr-only"> so far, still running</span>
    </span>
  );
}
