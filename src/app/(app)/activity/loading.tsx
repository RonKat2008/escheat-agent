import { PageHeader } from "@/components/primitives";
import { ActivitySkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Activity" description="The record an auditor asks for, newest first." />
        <ActivitySkeleton />
      </section>
    </NavHold>
  );
}
