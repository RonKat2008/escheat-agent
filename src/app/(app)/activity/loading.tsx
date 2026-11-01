import { PageHeader } from "@/components/primitives";
import { ActivitySkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Activity" description="The record an auditor asks for, newest first." />
      <ActivitySkeleton />
    </section>
  );
}
