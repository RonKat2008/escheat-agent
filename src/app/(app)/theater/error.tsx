"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";

export default function TheaterError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Agents" title="Watch it work" />
      <ErrorState
        title="The run could not load"
        message={safeErrorMessage(error, "The stored run could not be read. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </section>
  );
}
