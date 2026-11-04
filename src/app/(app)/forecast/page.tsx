import type { Metadata } from "next";
import Link from "next/link";
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
        actions={
          <Link
            href="/what-if"
            data-testid="forecast-what-if"
            className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] text-fg-2 transition-colors hover:border-blue-500 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            Try a what-if →
          </Link>
        }
      />
      <Suspense fallback={<ForecastSkeleton />}>
        <ForecastData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
