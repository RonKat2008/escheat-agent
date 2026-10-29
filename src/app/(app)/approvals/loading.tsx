import { PageHeader } from "@/components/primitives";
import { ApprovalsSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Approvals" description="Everything the agent wants to do that can't be undone waits here." />
      <ApprovalsSkeleton />
    </section>
  );
}
