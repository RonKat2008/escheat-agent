import { NavHold } from "@/components/shell/NavHold";
import { PageHeader } from "@/components/primitives";
import { TheaterSkeleton } from "./page";

export default function Loading() {
  return (
    <NavHold>
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Agents" title="Watch it work" />
      <TheaterSkeleton />
    </section>
    </NavHold>
  );
}
