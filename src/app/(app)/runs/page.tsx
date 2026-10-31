import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { RunsList } from "./RunsList";

export const metadata: Metadata = { title: "Agent runs" };

export function RunsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading runs">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[88, 112, 1, 84, 80, 96, 64].map((w, i) => (w === 1 ? <span key={i} className="w-3" /> : <Skel key={i} className="h-8" style={{ width: w }} />))}
      </div>
      <div className="border-t border-line">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-6 border-b border-line px-3">
            <Skel className="h-3 w-14" />
            <Skel className="h-3 w-32" />
            <Skel className="hidden h-3 w-56 lg:block" />
            <Skel className="ml-auto h-3 w-8" />
            <Skel className="h-3 w-12" />
            <Skel className="hidden h-3 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ agent?: string; status?: string; all?: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Agent runs"
        description="Every model call and browser action the agents took, with inputs, outputs, citations and cost. Open a run to read it step by step."
      />
      <Suspense fallback={<RunsSkeleton />}>
        <RunsList searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
