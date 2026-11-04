import { PageHeader } from "@/components/primitives";
import { TheaterSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Agents" title="Watch it work" />
      <TheaterSkeleton />
    </section>
  );
}
