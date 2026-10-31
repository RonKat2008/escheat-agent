import type { ReactNode } from "react";
import { Brand } from "@/components/shell/Brand";
import { DISCLAIMER } from "@/lib/disclaimer";

/**
 * Full-page state for 404 and route-level crashes (docs/DESIGN-RESEARCH.md §6.12). Left-aligned, large quiet code
 * as decoration (fg-4, aria-hidden), one heading, one sentence, one primary action. No card, no illustration.
 */
export function StatusPage({
  code,
  title,
  children,
  action,
  alert,
}: {
  code: string;
  title: string;
  children?: ReactNode;
  action: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-0 px-6 sm:px-10">
      <header className="pt-6">
        <Brand />
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <div role={alert ? "alert" : undefined} className="es-rise max-w-xl">
          <p aria-hidden className="text-[clamp(5rem,3rem+10vw,9rem)] leading-[0.9] font-semibold tracking-[-0.04em] text-fg-4 select-none">
            {code}
          </p>
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
