"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";

export default function HorizonError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Prevent" title="Pre-stale Horizon" />
      <ErrorState
        title="The horizon could not load"
        message={safeErrorMessage(error, "The pre-stale horizon could not load. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </section>
  );
}
