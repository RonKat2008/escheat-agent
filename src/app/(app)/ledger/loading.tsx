import { NavHold } from "@/components/shell/NavHold";
import { PageHeader } from "@/components/primitives";
import { LEDGER_DESCRIPTION, LedgerSkeleton } from "./skeleton";

export default function Loading() {
  return (
    <NavHold>
    <div>
      <PageHeader eyebrow="Accounting close" title="Escheat Ledger" description={LEDGER_DESCRIPTION} />
      <LedgerSkeleton />
    </div>
    </NavHold>
  );
}
