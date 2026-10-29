import { cn } from "@/lib/utils";

/** Pulse on the raised surface (opacity only; static under reduced motion). */
export function Skel({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-raised motion-reduce:animate-none", className)} />;
}
