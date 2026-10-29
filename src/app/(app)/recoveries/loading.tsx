import { PageHeader } from "@/components/primitives";
import { RecoveriesSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Recoveries" description="Money the states may be holding for your company." />
      <RecoveriesSkeleton />
    </section>
  );
}
