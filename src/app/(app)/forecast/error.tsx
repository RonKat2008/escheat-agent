"use client";

import { Button } from "@/components/ui/button";
import { safeErrorMessage } from "@/lib/ui/safe-error";
import { ErrorState, PageHeader } from "@/components/primitives";

export default function ForecastError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Forecast" />
      <ErrorState
        title="The forecast could not load"
        message={safeErrorMessage(error, "The forecast could not load. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
