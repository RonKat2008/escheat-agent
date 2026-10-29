import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { ReportsView } from "./ReportsView";

export const metadata: Metadata = { title: "Reports" };

export function ReportsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading reports">
      <div className="space-y-2 rounded-[14px] border border-border bg-surface p-3">
        {[0, 1, 2].map((i) => (
          <Skel key={i} className="h-[76px]" />
        ))}
      </div>
      <div className="space-y-4 rounded-[14px] border border-border bg-surface p-5">
        <Skel className="h-8 w-1/2" />
        <Skel className="h-24" />
        <Skel className="h-48" />
      </div>
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Reports"
        description="Per-state unclaimed property reports. Generate the NAUPA file, check it against the validator, approve it, then the filing agent submits it to the replica portal."
      />
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsView searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
