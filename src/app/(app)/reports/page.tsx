import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { ReportsView } from "./ReportsView";

export const metadata: Metadata = { title: "Reports" };

export function ReportsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading reports">
      <Skel className="h-[46px] w-full sm:w-[420px]" />
      <Skel className="h-8 w-1/2" />
      <Skel className="h-[76px]" />
      <Skel className="h-24" />
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
