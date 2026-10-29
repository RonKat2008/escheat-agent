"use client";

import "./globals.css";
import { DISCLAIMER } from "@/lib/disclaimer";

/** Last-resort boundary for errors in the root layout; it replaces the whole document, so it renders <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col bg-background px-4 text-foreground">
        <main className="flex flex-1 flex-col py-8">
          <div role="alert" className="mx-auto my-auto w-full max-w-md rounded-xl border border-border bg-surface p-6">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">Reload the page. If it keeps happening, restart the dev server.</p>
            {error.digest ? <p className="mt-3 font-mono text-[11px] text-subtle">ref {error.digest}</p> : null}
            <button type="button" onClick={reset} className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              Try again
            </button>
          </div>
        </main>
        <footer className="py-4 text-center text-xs text-muted-foreground">{DISCLAIMER}</footer>
      </body>
    </html>
  );
}
