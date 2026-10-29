import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { ItemsData } from "./data";
import { ItemsSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Items" };

export default function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader title="Items" description="Every stale payment, with the legal dates the rules engine computed for it." />
      <Suspense fallback={<ItemsSkeleton />}>
        <ItemsData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
