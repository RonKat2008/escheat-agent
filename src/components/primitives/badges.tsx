import Link from "next/link";
import { HelpCircle, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";

export const UNVERIFIED_TIP = "Depends on a rule value not yet verified by a human — see /rules";

/** Dashed amber outline is unique to this badge so it never reads as a status. */
export function UnverifiedBadge({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Hint content={UNVERIFIED_TIP}>
      <span
        data-testid="unverified-badge"
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-md border border-dashed border-at-risk/70 px-1.5 text-[10.5px] leading-none font-semibold tracking-[0.08em] text-at-risk uppercase",
          className,
        )}
      >
        <ShieldQuestion className="size-3" aria-hidden />
        {compact ? <span className="sr-only">Unverified</span> : "Unverified"}
      </span>
    </Hint>
  );
}

export function UnknownBadge({ className }: { className?: string }) {
  return (
    <Hint content="The engine could not compute this: a rule is missing. It reports UNKNOWN rather than guessing.">
      <span
        data-testid="unknown-badge"
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-md border border-danger/45 px-1.5 text-[10.5px] leading-none font-semibold tracking-[0.08em] text-danger uppercase",
          className,
        )}
      >
        <HelpCircle className="size-3" aria-hidden />
        Unknown — rule missing
      </span>
    </Hint>
  );
}

/** Verified rule values get a quiet check instead of a badge. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-resolved", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-resolved" />
      Verified
    </span>
  );
}

export function PrototypePill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border border-at-risk/60 px-2.5 text-xs font-medium tracking-[0.08em] text-at-risk uppercase",
        className,
      )}
    >
      Prototype
    </span>
  );
}

export function UnverifiedLink({ className }: { className?: string }) {
  return (
    <Link href="/rules" className={cn("rounded-md", className)}>
      <UnverifiedBadge />
    </Link>
  );
}
