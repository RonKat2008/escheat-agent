import { PageHeader } from "@/components/primitives";
import { WHAT_IF_DESCRIPTION, WHAT_IF_TITLE } from "./copy";
import { WhatIfSkeleton } from "./skeleton";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Simulate" title={WHAT_IF_TITLE} description={WHAT_IF_DESCRIPTION} />
      <WhatIfSkeleton />
    </section>
  );
}
