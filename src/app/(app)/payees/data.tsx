import { filterPayees, getPayeeDetail, listPayees } from "@/lib/payees/review-queries";
import { getCtx } from "@/lib/ui/ctx";
import { loadPayeesParams } from "./params";
import { PayeesClient } from "./payees-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PayeesData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = loadPayeesParams(await searchParams);
  const { db, companyId } = await getCtx();
  const all = await listPayees(db, companyId);
  const rows = filterPayees(all, { q: p.q, state: p.state?.slice(0, 2), show: p.show, basis: p.basis });
  const detail = p.payee && UUID.test(p.payee) ? await getPayeeDetail(db, companyId, p.payee) : null;
  return (
    <PayeesClient
      rows={rows}
      // The review queue and the merge picker always see every payee, whatever the filters say.
      allRows={all.map((r) => ({
        id: r.id,
        canonicalName: r.canonicalName,
        needsReview: r.needsReview,
        itemCount: r.itemCount,
        outstandingCents: r.outstandingCents,
        suggestions: r.suggestions,
      }))}
      detail={detail}
    />
  );
}
