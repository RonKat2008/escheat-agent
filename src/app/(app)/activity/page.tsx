import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { MarkVisited } from "@/components/motion";
import { ActivityData } from "./ActivityData";
import { NavHold } from "@/components/shell/NavHold";

export const metadata: Metadata = { title: "Activity" };

/** Mirrors the loaded layout: filter row, day strip, a day heading and entry rows at their real heights. */
export function ActivitySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading activity">
      <div className="mb-10">
        <div className="mb-3 flex justify-between px-3">
          <Skel className="h-5 w-56" />
          <Skel className="h-3 w-32 max-sm:hidden" />
        </div>
        <div className="flex h-[76px] items-center gap-[3px] rounded-[10px] border border-line px-3">
          {Array.from({ length: 30 }, (_, i) => (
            <Skel key={i} className="h-[3px] flex-1 rounded-[1px]" />
          ))}
        </div>
        <div className="mt-1.5 h-4" />
      </div>
      <div className="mb-6 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
        <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-1">
          <Skel className="h-3 w-12" />
          <Skel className="h-9" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <Skel className="h-3 w-10" />
            <Skel className="h-9" />
          </div>
        ))}
        <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-1">
          <Skel className="h-9 w-16" />
          <Skel className="h-9 w-16" />
          <Skel className="h-9 w-28" />
        </div>
      </div>
      <Skel className="mx-3 mb-2.5 h-3 w-28" />
      <div className="border-t border-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-[67px] items-center gap-6 border-b border-line px-3">
            <Skel className="h-3 w-16" />
            <Skel className="h-3 w-16 max-sm:hidden" />
            <Skel className="h-3 w-56" />
          </div>
        ))}
      </div>
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
      <Suspense fallback={<NavHold><ActivitySkeleton /></NavHold>}>
        <ActivityData searchParams={searchParams} />
      </Suspense>
      <MarkVisited id="activity" />
    </section>
  );
}
