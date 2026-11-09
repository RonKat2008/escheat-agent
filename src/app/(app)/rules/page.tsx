import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { RulesBody } from "./rules-body";
import { RulesSkeleton } from "./skeleton";
import { NavHold } from "@/components/shell/NavHold";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader
        title="Rules"
        description="Every legal date is computed from these values, and anything that depends on a value no person has verified is marked unverified."
      />
      <Suspense fallback={<NavHold><RulesSkeleton /></NavHold>}>
        <RulesBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
