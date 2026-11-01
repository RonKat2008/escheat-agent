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

/** Mirrors the workspace (list pane with header and tabs, detail with header, preview and footer) so nothing jumps. */
export function ApprovalsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading approvals"
      className="-mx-4 grid grid-cols-[minmax(0,1fr)] overflow-clip border-y border-line bg-ink-1 sm:mx-0 sm:rounded-xl sm:border-x lg:grid-cols-[360px_minmax(0,1fr)]"
    >
      <div className="lg:border-r lg:border-line">
        <div className="flex h-[38px] items-center px-4 pt-1.5">
          <Skel className="h-4 w-28" />
        </div>
        <div className="flex h-10 items-center gap-4 border-b border-line px-4">
          <Skel className="h-3.5 w-10" />
          <Skel className="h-3.5 w-16" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex h-[68px] items-start gap-3 py-3 pr-4 pl-10">
              <Skel className="size-4" />
              <div className="flex-1 space-y-2">
                <Skel className="h-3.5 w-3/5" />
                <Skel className="h-3 w-4/5" />
              </div>
              <Skel className="h-3.5 w-14" />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden bg-ink-0 px-6 pt-6 pb-6 lg:block">
        <Skel className="h-3.5 w-16" />
        <Skel className="mt-2 h-7 w-2/3" />
        <Skel className="mt-2 h-4 w-1/3" />
        <Skel className="mt-7 h-8 w-64" />
        <Skel className="mt-7 h-4 w-28" />
        <Skel className="mt-2 h-10 w-full max-w-xl" />
        <Skel className="mt-7 h-[300px] w-full rounded-xl" />
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
