"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";

export default function LedgerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Escheat Ledger" />
      <ErrorState
        title="The ledger could not load"
        message={safeErrorMessage(error, "The ledger could not load. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
