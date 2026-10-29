"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Dashboard" />
      <ErrorState
        title="The dashboard could not load"
        message={error.message || "Unexpected error. If this is a fresh checkout, run pnpm seed:demo && pnpm pipeline:run."}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
