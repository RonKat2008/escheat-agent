import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { HeroExposure } from "./hero";
import { AuditInterest, DeadlinesPanel, FeaturedItem, StatusPanel } from "./sections";
import { HeroSkeleton, SectionSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Editorial, un-boxed composition: one loud number, then two quiet columns separated by hairlines.
 * The featured check is the only bordered panel because it is a real object you open.
 */
export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="Dashboard" description="What Northwind Fixtures owes the states in unclaimed property, and what is due next." />
      <Suspense fallback={<HeroSkeleton />}>
        <HeroExposure />
      </Suspense>
      <div className="mt-14 grid gap-x-12 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Suspense fallback={<SectionSkeleton rows={6} title="Next deadlines" />}>
            <DeadlinesPanel />
          </Suspense>
        </div>
        <div className="lg:col-span-5">
          <Suspense fallback={<SectionSkeleton rows={6} title="By status" />}>
            <StatusPanel />
          </Suspense>
        </div>
        <div className="lg:col-span-7">
          <Suspense fallback={<SectionSkeleton rows={5} title="Featured item" />}>
            <FeaturedItem />
          </Suspense>
        </div>
        <div className="lg:col-span-5">
          <Suspense fallback={<SectionSkeleton rows={4} title="Audit-interest exposure" />}>
            <AuditInterest />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
