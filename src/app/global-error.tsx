"use client";

import "./globals.css";
import { DISCLAIMER } from "@/lib/disclaimer";

/** Last-resort boundary for errors in the root layout; it replaces the whole document, so it renders <html>. Self-contained: no shell components. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col bg-ink-0 px-6 text-fg-1 sm:px-10">
        <main className="flex flex-1 flex-col justify-center py-16">
          <div role="alert" className="max-w-xl">
            <p aria-hidden className="text-[clamp(5rem,3rem+10vw,9rem)] leading-[0.9] font-semibold tracking-[-0.04em] text-fg-4 select-none">
              Error
            </p>
            <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">Something went wrong</h1>
            <p className="mt-3 max-w-md text-[15px] leading-6 text-fg-2">Reload the page. If it keeps happening, restart the dev server.</p>
            {error.digest ? <p className="mt-3 font-mono text-[11px] text-fg-3">ref {error.digest}</p> : null}
            <button
              type="button"
              onClick={reset}
              className="mt-8 inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-[#3369ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              Try again
            </button>
          </div>
        </main>
        <footer className="border-t border-line py-4">
          <p className="text-xs text-fg-3">{DISCLAIMER}</p>
        </footer>
      </body>
    </html>
  );
}
