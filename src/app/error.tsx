"use client";

import { Button } from "@/components/ui/button";
import { StatusPage } from "./_status/StatusPage";

/** Catches errors in the app chrome itself ((app)/layout, e.g. the header's DB read on an unseeded database). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      alert
      code="Error"
      title="Escheat Agent could not load"
      action={
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
      }
    >
      <p>The app could not read its data. On a fresh checkout, seed the synthetic demo company first:</p>
      <pre className="overflow-x-auto rounded-md border border-line bg-ink-1 px-3 py-2 font-mono text-xs text-fg-1">pnpm seed:demo</pre>
      {error.digest ? <p className="font-mono text-[11px] text-fg-3">ref {error.digest}</p> : null}
    </StatusPage>
  );
}
