"use client";

import { ErrorState } from "@/components/primitives";
import { ActionButton } from "@/components/b/ActionButton";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load reports"
      message={error.message || "Unexpected error while reading reports."}
      action={
        <ActionButton variant="quiet" onClick={reset}>
          Try again
        </ActionButton>
      }
    />
  );
}
