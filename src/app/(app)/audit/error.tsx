"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";

export default function AuditError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <PageHeader eyebrow="Audit drill" title="Are we ready for an audit?" />
      <ErrorState
        title="The audit drill could not load"
        message={safeErrorMessage(error, "The audit drill could not load. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
