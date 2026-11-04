import { PageHeader } from "@/components/primitives";
import { HorizonSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Prevent" title="Pre-stale Horizon" />
      <HorizonSkeleton />
    </section>
  );
}
