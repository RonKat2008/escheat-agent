"use client";

import { ErrorState } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";
import { ActionButton } from "@/components/b/ActionButton";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load agent runs"
      message={safeErrorMessage(error, "Unexpected error while reading runs.")}
      action={
        <ActionButton variant="quiet" onClick={reset}>
          Try again
        </ActionButton>
      }
    />
  );
}
