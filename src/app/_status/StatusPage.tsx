import type { ReactNode } from "react";
import { Brand } from "@/components/shell/Brand";
import { DISCLAIMER } from "@/lib/disclaimer";

/**
 * Dashed lifecycle ring (§6.18): the "Unknown" marker of the lifecycle diagrams, at display size. Decorative; the
 * label next to it is real text.
 */
function UnknownRing({ label }: { label: string }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <svg aria-hidden width="40" height="40" viewBox="0 0 40 40" fill="none" className="shrink-0">
        <circle cx="20" cy="20" r="17" className="stroke-fg-4" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="20" cy="20" r="3" className="stroke-fg-3" strokeWidth="1.5" />
      </svg>
      <span className="instrument-label">{label}</span>
    </div>
  );
}

/**
 * Full-page state for 404 and route-level crashes (DESIGN-V3 §6.18). Left-aligned, a large quiet code as decoration
 * (fg-4, aria-hidden), one heading, one sentence, one primary action, the disclaimer. No card, no illustration.
 */
export function StatusPage({
  code,
  title,
  children,
  action,
  alert,
  ringLabel,
}: {
  code: string;
  title: string;
  children?: ReactNode;
  action: ReactNode;
  alert?: boolean;
  /** Shows the dashed "unknown" lifecycle ring with this instrument label (the 404 uses "Unknown route"). */
  ringLabel?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-0 px-6 sm:px-10">
      <header className="pt-6">
        <Brand />
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center py-16">
        <div role={alert ? "alert" : undefined} className="es-rise max-w-xl">
          {/* Purely decorative glyph (WCAG 1.4.3 exempts it). Drawn as generated content so it is not text to
              assistive tech or contrast checkers; the h1 below carries the meaning. */}
          <p
            aria-hidden
            data-code={code}
            className="text-display font-medium tracking-[-0.045em] text-fg-4 select-none before:content-[attr(data-code)] sm:text-[clamp(5rem,3rem+10vw,9rem)] sm:leading-[0.9]"
          />
          {ringLabel ? <UnknownRing label={ringLabel} /> : null}
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-fg-1">{title}</h1>
          {children ? <div className="mt-3 max-w-md space-y-3 text-[15px] leading-6 text-fg-2">{children}</div> : null}
          <div className="mt-8 flex flex-wrap items-center gap-3">{action}</div>
        </div>
      </main>
      <footer className="border-t border-line py-4">
        <p className="text-xs text-fg-3">{DISCLAIMER}</p>
      </footer>
    </div>
  );
}
