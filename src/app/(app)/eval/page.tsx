import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { EvalView } from "./EvalView";

export const metadata: Metadata = { title: "Eval" };

export function EvalSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading eval results">
      <Skel className="h-20 rounded-[14px]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skel key={i} className="h-[104px] rounded-[14px]" />
        ))}
      </div>
      <Skel className="h-72 rounded-[14px]" />
    </div>
  );
}

export default function Page() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Eval"
        description="How well the classifier sorts the 200 labeled test items: property type, owner state, why that state, and whether the item is stale. Numbers come only from the stored run below."
      />
      <Suspense fallback={<EvalSkeleton />}>
        <EvalView />
      </Suspense>
    </section>
  );
}
