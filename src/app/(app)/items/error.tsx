"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";

export default function ItemsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Items" />
      <ErrorState
        title="Items could not load"
        message={error.message}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
