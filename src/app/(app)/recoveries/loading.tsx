import { PageHeader } from "@/components/primitives";
import { RecoveriesSkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Recoveries" description="Money the states may be holding for your company." />
        <RecoveriesSkeleton />
      </section>
    </NavHold>
  );
}
