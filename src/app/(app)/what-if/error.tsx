"use client";

import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/primitives";
import { safeErrorMessage } from "@/lib/ui/safe-error";
import { WHAT_IF_TITLE } from "./copy";

export default function WhatIfError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Simulate" title={WHAT_IF_TITLE} />
      <ErrorState
        title="The simulator could not load"
        message={safeErrorMessage(error, "The what-if simulator could not load. Try again; if it keeps happening, restart the dev server.")}
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </section>
  );
}
