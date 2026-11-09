import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Info, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";

export const UNVERIFIED_TIP = "This rule value has not been verified by a person. Dates that depend on it are provisional.";

/**
 * Per-value unverified marker (§7): mono 10px uppercase UNVERIFIED in a 1px line-strong box, fg-2, with a tooltip.
 * It renders on every unverified value and every date or amount derived from one. `compact` keeps only the shield
 * glyph (the word stays for assistive tech) for dense table cells.
 */
export function UnverifiedBadge({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Hint content={UNVERIFIED_TIP} className="inline-flex rounded-sm">
      {compact ? (
        <span data-testid="unverified-badge" className={cn("inline-flex items-center text-fg-2", className)}>
          <ShieldQuestion className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Unverified</span>
        </span>
      ) : (
        <span
          data-testid="unverified-badge"
          className={cn(
            "inline-flex h-[18px] items-center rounded-[4px] border border-line-strong px-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-fg-2 uppercase",
            className,
          )}
        >
          Unverified
        </span>
      )}
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

/** Verified rule values get the steel-blue check. */
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
      className={cn("glass-pill inline-flex h-6 shrink-0 items-center gap-1.5 px-2.5 text-xs whitespace-nowrap text-fg-2", className)}
    >
      <span aria-hidden className="size-1.5 rounded-full border border-fg-3" />
      Demo data
    </span>
  );
}
/**
 * "Synthetic data" chip for the top bar and diagrams (§6.0, §8.3). A glass pill. Static: no coral, nothing here needs a person.
 */
export function SyntheticChip({ className, label = "Synthetic data" }: { className?: string; label?: string }) {
  return (
    <span
      title="Prototype running on synthetic data. No real company or payee records."
      data-testid="synthetic-chip"
      className={cn("glass-pill inline-flex h-6 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[11px] font-medium tracking-[0.04em] whitespace-nowrap text-fg-2", className)}
    >
      <span aria-hidden className="size-1.5 rounded-full border border-fg-3" />
      {label}
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
    <div role="note" className={cn("flex items-start gap-2.5 rounded-[14px] border border-blue-800/80 bg-blue-900/70 px-3.5 py-2.5 text-[13px] text-blue-200 backdrop-blur-md", className)}>
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
