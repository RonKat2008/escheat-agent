import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { RulesBody } from "./rules-body";
import { RulesSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader
        title="Rules"
        description="Every legal date is computed from these values. Until a human verifies a value against its source, anything that depends on it is marked unverified."
      />
      <Suspense fallback={<RulesSkeleton />}>
        <RulesBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
