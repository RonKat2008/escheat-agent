import type { Metadata } from "next";
import { Suspense } from "react";
import { NavHold } from "@/components/shell/NavHold";
import { PageHeader } from "@/components/primitives";
import { getCtx } from "@/lib/ui/ctx";
import { loadWhatIfSnapshot } from "@/lib/what-if/load";
import { WHAT_IF_DESCRIPTION, WHAT_IF_TITLE } from "./copy";
import { WhatIfSkeleton } from "./skeleton";
import { WhatIfView } from "./WhatIfView";

export const metadata: Metadata = { title: "What-if" };

async function WhatIfData() {
  const { db, companyId } = await getCtx();
  const snapshot = await loadWhatIfSnapshot(db, companyId);
  return <WhatIfView snapshot={snapshot} />;
}

/** Read-only simulator: SELECTs only, the projection is pure, the demo clock never moves. */
export default function WhatIfPage() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Simulate" title={WHAT_IF_TITLE} description={WHAT_IF_DESCRIPTION} />
      <Suspense fallback={<NavHold><WhatIfSkeleton /></NavHold>}>
        <WhatIfData />
      </Suspense>
    </section>
  );
}
