import type { Metadata } from "next";
import { Suspense } from "react";
import { MarkVisited } from "@/components/motion";
import "@/components/motion/motion.css";
import { PageHeader } from "@/components/primitives";
import { MoneyFlowSection } from "./flow-section";
import { HeroExposure } from "./hero";
import { AuditInterest, DeadlinesPanel, FeaturedItem, StatusPanel } from "./sections";
import { DashboardSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * DESIGN-V3 §6.3. Row 1: overdue (when anything is), then the hero: the total and Needs you on the left, the Money Map
 * on the right. Row 2: the money-flow Sankey. Row 3: next deadlines and status. Row 4: audit interest and the featured
 * check's lifecycle.
 *
 * One Suspense boundary for the whole page (CLS): sections share one cached read (./data.ts), so they resolve together
 * and replace a skeleton that is taller than the viewport. Nothing that was visible moves when content arrives, and
 * the overdue panel can never pop in above content that already painted.
 */
export default function DashboardPage() {
  return (
    // sr-only tables cannot shrink below their unwrapped text and are absolutely positioned, so every SrTable host is
    // `relative overflow-x-clip` (its containing block clips it); this root is the same guard for anything else.
    <div className="relative min-w-0 overflow-x-clip">
      <MarkVisited id="dashboard" />
      <PageHeader title="Dashboard" description="What Northwind Fixtures owes the states in unclaimed property, where the money is, and what is due next." />
      <Suspense fallback={<DashboardSkeleton />}>
        <HeroExposure />
        <MoneyFlowSection />
        <div className="mt-14 grid gap-x-12 gap-y-12 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <DeadlinesPanel />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <StatusPanel />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <AuditInterest />
          </div>
          <div className="min-w-0 lg:col-span-7">
            <FeaturedItem />
          </div>
        </div>
      </Suspense>
    </div>
  );
}
