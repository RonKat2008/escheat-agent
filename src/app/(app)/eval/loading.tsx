import { PageHeader } from "@/components/primitives";
import { EvalSkeleton } from "./page";
import { NavHold } from "@/components/shell/NavHold";

export default function Loading() {
  return (
    <NavHold>
      <section aria-labelledby="page-heading">
        <PageHeader title="Eval" description="Classifier accuracy on the labeled test set." />
        <EvalSkeleton />
      </section>
    </NavHold>
  );
}
