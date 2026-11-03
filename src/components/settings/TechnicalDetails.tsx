import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * R3-14: the only place a config name (an env var) may appear in the finance UI. Collapsed by default, so the visible
 * copy stays in operator language. Names only, never values.
 */
export function TechnicalDetails({ children, className, summary = "Technical details" }: { children: ReactNode; className?: string; summary?: string }) {
  return (
    <details data-testid="technical-details" className={cn("group/td mt-2 text-[13px]", className)}>
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-fg-3 select-none hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform duration-150 group-open/td:rotate-90" strokeWidth={1.5} aria-hidden />
        {summary}
      </summary>
      <div className="mt-2 rounded-md border border-line bg-ink-1 p-3 text-fg-2">{children}</div>
    </details>
  );
}

/** A list of config names for the disclosure (names only; values are never read into the UI). */
export function ConfigNames({ names, intro }: { names: readonly string[]; intro?: string }) {
  return (
    <>
      <p>{intro ?? "Set by whoever runs this deployment, in the server environment, followed by a restart:"}</p>
      <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-fg-1">
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}
