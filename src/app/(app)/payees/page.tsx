import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { PayeesData } from "./data";
import { PayeesSkeleton } from "./skeleton";
import { NavHold } from "@/components/shell/NavHold";

export const metadata: Metadata = { title: "Payees" };

export default function PayeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader
        title="Payees"
        description="Name variants merged into one payee decide which state owns an item. Review the shaky merges, and change any of them by hand. Nothing here is decided by a model."
      />
      <Suspense fallback={<NavHold><PayeesSkeleton /></NavHold>}>
        <PayeesData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
