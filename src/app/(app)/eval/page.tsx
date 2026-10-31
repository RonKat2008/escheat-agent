import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { EvalView } from "./EvalView";

export const metadata: Metadata = { title: "Eval" };

export function EvalSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading eval results">
      <Skel className="h-[66px] rounded-[10px]" />
      <div className="grid grid-cols-2 gap-6 border-y border-line py-6 sm:flex">
        <Skel className="col-span-2 h-[88px] w-48" />
        {[0, 1, 2].map((i) => (
          <Skel key={i} className="h-[72px] w-32" />
        ))}
      </div>
      <div className="space-y-6 border-t border-line pt-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Skel className="h-4 w-28" />
            <div className="space-y-2">
              <Skel className="h-1.5" />
              <Skel className="h-1.5" />
            </div>
          </div>
        ))}
      </div>
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
