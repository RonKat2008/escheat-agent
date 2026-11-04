import { PageHeader } from "@/components/primitives";
import { ApprovalsSkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Approvals" description="Everything the agent wants to do that can't be undone waits here." />
        <ApprovalsSkeleton />
      </section>
    </NavHold>
  );
}
