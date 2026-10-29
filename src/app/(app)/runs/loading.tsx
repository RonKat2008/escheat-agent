import { PageHeader } from "@/components/primitives";
import { RunsSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Agent runs" description="Every model call and browser action the agents took." />
      <RunsSkeleton />
    </section>
  );
}
