import { PageHeader } from "@/components/primitives";
import { EvalSkeleton } from "./page";

export default function Loading() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader title="Eval" description="Classifier accuracy on the labeled test set." />
      <EvalSkeleton />
    </section>
  );
}
