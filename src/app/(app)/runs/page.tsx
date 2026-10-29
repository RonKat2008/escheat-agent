import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { RunsList } from "./RunsList";

export const metadata: Metadata = { title: "Agent runs" };

export function RunsSkeleton() {
  return (
    <div className="space-y-2 rounded-[14px] border border-border bg-surface p-3" aria-busy="true" aria-label="Loading runs">
      {Array.from({ length: 8 }, (_, i) => (
        <Skel key={i} className="h-9" />
      ))}
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
