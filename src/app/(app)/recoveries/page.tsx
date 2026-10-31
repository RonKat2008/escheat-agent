import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { RecoveriesView } from "./RecoveriesView";

export const metadata: Metadata = { title: "Recoveries" };

export function RecoveriesSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading recoveries">
      <div>
        <Skel className="mb-3 h-4 w-40" />
        <Skel className="h-14 w-72" />
      </div>
      <Skel className="h-[76px]" />
      <Skel className="h-48 rounded-xl" />
    </div>
  );
}

export default function Page() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Recoveries"
        description="Money the states may be holding for your company. The recovery agent searches replica portals for your company name and its variants; you approve every claim."
      />
      <Suspense fallback={<RecoveriesSkeleton />}>
        <RecoveriesView />
      </Suspense>
    </section>
  );
}
