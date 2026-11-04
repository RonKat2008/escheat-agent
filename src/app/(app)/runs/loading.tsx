import { PageHeader } from "@/components/primitives";
import { RunsSkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Agent runs" description="Every model call and browser action the agents took." />
        <RunsSkeleton />
      </section>
    </NavHold>
  );
}
