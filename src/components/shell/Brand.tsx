import Link from "next/link";

/**
 * The V3 mark (§6.0): a flat square with one blue diagonal "thread" of light crossing it. No gradient tile, no bolt,
 * never glows.
 */
export function BrandMark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className ?? ""}`}>
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.25" className="fill-ink-3 stroke-line-strong" strokeWidth="1" />
      <path d="M3.5 12.5 12.5 3.5" className="stroke-blue-500" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12.5" cy="3.5" r="1.25" className="fill-blue-300" />
    </svg>
  );
}

/** Wordmark: Geist 600 next to the mark. Links to the dashboard. */
export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/dashboard" className={`flex items-center gap-2.5 rounded-md ${className ?? ""}`} aria-label="Escheat Agent, dashboard">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-[-0.015em] text-fg-1 group-data-[collapsed=true]/shell:sr-only">Escheat Agent</span>
    </Link>
  );
}
