import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { ActivityData } from "./ActivityData";

export const metadata: Metadata = { title: "Activity" };

export function ActivitySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading activity" className="border-t border-line">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-6 border-b border-line px-3">
          <Skel className="h-3 w-28" />
          <Skel className="h-3 w-16" />
          <Skel className="h-3 w-56" />
        </div>
      ))}
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Activity"
        description="The record an auditor asks for: who approved what and when, what was sent, filed and changed, newest first. Every entry is a stored row; nothing is inferred."
      />
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityData searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
