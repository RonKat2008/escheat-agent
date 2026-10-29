import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/primitives";
import { Skel } from "@/components/b/Skel";
import { getCtx } from "@/lib/ui/ctx";
import { ApprovalsWorkspace } from "./ApprovalsWorkspace";
import { loadQueue } from "./queue-data";

export const metadata: Metadata = { title: "Approvals" };

async function Queue({ sel }: { sel: Promise<{ sel?: string }> }) {
  const { sel: initial } = await sel;
  const { db, companyId } = await getCtx();
  const data = await loadQueue(db, companyId);
  return <ApprovalsWorkspace data={data} initialKey={initial ?? null} />;
}

export function ApprovalsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading approvals">
      <div className="space-y-2 rounded-[14px] border border-border bg-surface p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skel key={i} className="h-14" />
        ))}
      </div>
      <div className="space-y-3 rounded-[14px] border border-border bg-surface p-5">
        <Skel className="h-7 w-2/3" />
        <Skel className="h-4 w-1/3" />
        <Skel className="h-[360px]" />
      </div>
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ sel?: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader
        title="Approvals"
        description="Everything the agent wants to do that can't be undone waits here. Nothing is sent, filed or claimed until you approve it."
      />
      <Suspense fallback={<ApprovalsSkeleton />}>
        <Queue sel={searchParams} />
      </Suspense>
    </section>
  );
}
