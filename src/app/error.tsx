"use client";

import { DISCLAIMER } from "@/lib/disclaimer";

/** Catches errors in the app chrome itself ((app)/layout, e.g. the header's DB read on an unseeded database). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col px-4">
      <main className="flex flex-1 flex-col py-8">
        <div role="alert" className="mx-auto my-auto w-full max-w-md rounded-xl border border-border bg-surface p-6">
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">Error</p>
          <h1 className="mt-1 text-lg font-semibold">Escheat Agent could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app could not read its data. On a fresh checkout, seed the synthetic demo company first:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-xs">pnpm seed:demo</pre>
          {error.digest ? <p className="mt-3 font-mono text-[11px] text-subtle">ref {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2"
          >
            Try again
          </button>
        </div>
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">{DISCLAIMER}</footer>
    </div>
  );
}
