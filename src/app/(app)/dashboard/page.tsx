import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { AuditInterest, DeadlinesPanel, FeaturedItem, HeroExposure, NeedsReview, StatusPanel } from "./sections";
import { CardSkeleton, HeroSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="What Northwind Fixtures owes the states in unclaimed property, and what is due next." />
      <Suspense fallback={null}>
        <NeedsReview />
      </Suspense>
      <Suspense fallback={<HeroSkeleton />}>
        <HeroExposure />
      </Suspense>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7 [&>*]:h-full">
          <Suspense fallback={<CardSkeleton rows={6} title="Deadlines, next 90 days" />}>
            <DeadlinesPanel />
          </Suspense>
        </div>
        <div className="xl:col-span-5 [&>*]:h-full">
          <Suspense fallback={<CardSkeleton rows={6} title="Status" />}>
            <StatusPanel />
          </Suspense>
        </div>
        <div className="xl:col-span-5 [&>*]:h-full">
          <Suspense fallback={<CardSkeleton rows={5} title="Featured item" />}>
            <FeaturedItem />
          </Suspense>
        </div>
        <div className="xl:col-span-7 [&>*]:h-full">
          <Suspense fallback={<CardSkeleton rows={4} title="Audit-interest exposure" />}>
            <AuditInterest />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
