"use client";

import { ErrorState } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";
import { ActionButton } from "@/components/b/ActionButton";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load the approval queue"
      message={safeErrorMessage(error, "Unexpected error while reading the queue.")}
      action={
        <ActionButton variant="quiet" onClick={reset}>
          Try again
        </ActionButton>
      }
    />
  );
}
