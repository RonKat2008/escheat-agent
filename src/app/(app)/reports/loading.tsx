import { PageHeader } from "@/components/primitives";
import { ReportsSkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Reports" description="Per-state unclaimed property reports." />
        <ReportsSkeleton />
      </section>
    </NavHold>
  );
}
