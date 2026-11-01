import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { ForecastData } from "./data";
import { ForecastSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Forecast" };

/** Liability forecast + deadline calendar. Every date comes from the deterministic rules engine; nothing is guessed. */
export default function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader
        title="Forecast"
        description="What becomes presumed abandoned, which due-diligence windows open, and when reports and remittances are due, month by month."
      />
      <Suspense fallback={<ForecastSkeleton />}>
        <ForecastData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
