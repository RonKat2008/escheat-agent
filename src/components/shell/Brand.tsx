import Link from "next/link";

/**
 * The mark (V4): a navy tile with one steel diagonal "thread" crossing it, ending in a coral point (the moment a person
 * acts). No gradient tile, no bolt, never glows.
 */
export function BrandMark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className ?? ""}`}>
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="4.25" className="fill-ink-3 stroke-line-strong" strokeWidth="1" />
      <path d="M3.5 12.5 12.5 3.5" className="stroke-blue-400" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12.5" cy="3.5" r="1.4" className="fill-pink-500" />
    </svg>
  );
}

const WORDMARK = "text-[15px] font-medium tracking-[-0.02em] text-fg-1";

/** Wordmark: Geist 500, tight, next to the mark (like the reference's "Tidewell"). Links to the dashboard. */
export function Brand({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <Link href="/dashboard" className={`flex items-center gap-2.5 rounded-full ${className ?? ""}`} aria-label="Escheat Agent, dashboard">
      <BrandMark />
      <span className={textClassName ?? `${WORDMARK} group-data-[collapsed=true]/shell:sr-only`}>Escheat Agent</span>
    </Link>
  );
}
