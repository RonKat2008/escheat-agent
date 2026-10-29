import { PageHeader } from "@/components/primitives";
import { ReportsSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Reports" description="Per-state unclaimed property reports." />
      <ReportsSkeleton />
    </section>
  );
}
