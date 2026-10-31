import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Info, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";

export const UNVERIFIED_TIP = "Depends on a rule value not yet verified by a human. Review it in Rules.";

/**
 * Per-value unverified marker: a small shield glyph, no container. Pages state the general caveat once with
 * <UnverifiedBanner/>; this marks each affected value so it is never hidden.
 */
export function UnverifiedBadge({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Hint content={UNVERIFIED_TIP} className="inline-flex rounded-sm">
      <span data-testid="unverified-badge" className={cn("inline-flex items-center gap-1 text-xs leading-none text-fg-3", className)}>
        <ShieldQuestion className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {compact ? <span className="sr-only">Unverified</span> : "Unverified"}
      </span>
    </Hint>
  );
}

/** The engine could not compute this. Hollow ring + italic: never a substituted number. */
export function UnknownBadge({ className, label = "Unknown, no rule" }: { className?: string; label?: string }) {
  return (
    <Hint content="The engine could not compute this: a rule is missing. It reports Unknown rather than guessing." className="inline-flex rounded-sm">
      <span data-testid="unknown-badge" className={cn("inline-flex items-center gap-1.5 text-[13px] text-fg-3 italic", className)}>
        <span aria-hidden className="size-2 shrink-0 rounded-full ring-[1.5px] ring-fg-3 ring-inset" />
        {label}
      </span>
    </Hint>
  );
}

/** Verified rule values get the blue check. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-fg-2", className)}>
      <CheckCircle2 className="size-3.5 text-blue-500" strokeWidth={1.75} aria-hidden />
      Verified
    </span>
  );
}

/** The one demo marker in the chrome. */
export function DemoMarker({ className }: { className?: string }) {
  return (
    <span
      title="Prototype running on synthetic data"
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs whitespace-nowrap text-fg-2", className)}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-pink-500" />
      Demo data
    </span>
  );
}
/** @deprecated use DemoMarker */
export const PrototypePill = DemoMarker;

export function UnverifiedLink({ className }: { className?: string }) {
  return (
    <Link href="/rules" className={cn("rounded-sm", className)}>
      <UnverifiedBadge />
    </Link>
  );
}

/** One per page: states the unverified caveat once, so individual rows only need the glyph. */
export function UnverifiedBanner({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-2.5 rounded-lg border border-blue-800/70 bg-blue-900/70 px-3.5 py-2.5 text-[13px] text-blue-300", className)}>
      <Info className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <p className="min-w-0">
        {children ?? (
          <>
            Some rule values behind these dates are unverified, so dates are provisional. Values marked{" "}
            <ShieldQuestion className="inline size-3.5 -translate-y-px" strokeWidth={1.75} aria-label="with a shield" /> need a human check in{" "}
            <Link href="/rules" className="text-fg-1 underline decoration-blue-300/50 underline-offset-2 hover:decoration-fg-1">
              Rules
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}
