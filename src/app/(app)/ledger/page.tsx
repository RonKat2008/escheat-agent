import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { LedgerData } from "./data";
import { LEDGER_DESCRIPTION, LedgerSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Escheat Ledger" };

/** Escheat Ledger: liability roll-forward + journal entries. Read only; the CSV is a file, nothing is posted. */
export default function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <div>
      <PageHeader eyebrow="Accounting close" title="Escheat Ledger" description={LEDGER_DESCRIPTION} />
      <Suspense fallback={<LedgerSkeleton />}>
        <LedgerData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
