import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { loadAuditDrill } from "@/lib/queries/audit";
import { getCtx } from "@/lib/ui/ctx";
import { AuditIntro, AuditRequestForm, AuditResults } from "./AuditView";
import { AuditSkeleton } from "./loading";
import { loadAuditParams } from "./params";

export const metadata: Metadata = { title: "Audit drill" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function AuditData({ searchParams }: { searchParams: SearchParams }) {
  const p = loadAuditParams(await searchParams);
  if (!p.state) {
    return (
      <div className="space-y-6">
        <AuditRequestForm state={null} size={p.size} all={p.all} />
        <AuditIntro />
      </div>
    );
  }
  const { db, companyId } = await getCtx();
  const drill = await loadAuditDrill(db, companyId, { state: p.state, size: p.size, all: p.all });
  return (
    <div className="space-y-6">
      <AuditRequestForm state={p.state} size={p.size} all={p.all} />
      <AuditResults drill={drill} />
    </div>
  );
}

/**
 * Audit Drill: "Delaware just sent an audit letter. Are we ready?" Draws a reproducible sample for a state and shows
 * each item's proof chain, from the ledger row to the remittance. Read-only.
 */
export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div>
      <PageHeader
        eyebrow="Audit drill"
        title="Are we ready for an audit?"
        description="Simulate a state's audit request: a reproducible sample of items, each traced from the ledger to the remittance. Pink links need a person; each one opens the place to fix it."
      />
      <Suspense fallback={<AuditSkeleton />}>
        <AuditData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
