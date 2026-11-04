import type { Metadata } from "next";
import { Suspense } from "react";
import { NavHold } from "@/components/shell/NavHold";
import { PageHeader } from "@/components/primitives";
import { getHorizon, type DormancyRing } from "@/lib/queries/horizon";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import { getCtx } from "@/lib/ui/ctx";
import { HorizonView, type HorizonRing } from "./HorizonView";

export const metadata: Metadata = { title: "Pre-stale Horizon" };

const HORIZON_TITLE = "Pre-stale Horizon";
const HORIZON_DESCRIPTION =
  "Stop escheat before it starts: outstanding payments that are not yet stale, drifting toward the stale line and each state's presumed-abandoned point, with a worklist to cash or reissue them.";

function ringLabel(r: DormancyRing): HorizonRing {
  const states = [...new Set(r.members.map((m) => m.state))];
  const types = [...new Set(r.members.map((m) => PROPERTY_TYPE_LABEL[m.propertyType] ?? m.propertyType))];
  return { days: r.days, label: `${states.join(" · ")} · ${r.days.toLocaleString("en-US")} days`, unverified: r.unverified, states, types };
}

async function HorizonData() {
  const { db, companyId } = await getCtx();
  const h = await getHorizon(db, companyId);
  return (
    <HorizonView
      asOf={h.asOf}
      thresholdDays={h.thresholdDays}
      items={h.items}
      totalCents={h.totalCents}
      buckets={h.buckets}
      rings={h.rings.map(ringLabel)}
      awaitingDetection={h.awaitingDetection}
    />
  );
}

export function HorizonSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading the pre-stale horizon">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-[10px] border border-line bg-ink-2" />
        ))}
      </div>
      <div className="mx-auto aspect-square w-full max-w-[560px] animate-pulse rounded-full border border-line bg-ink-2" />
      <div className="h-64 animate-pulse rounded-[10px] border border-line bg-ink-2" />
    </div>
  );
}

/** Read-only: reconciliation runs with persist:false, nothing is written, nothing is sent. */
export default function HorizonPage() {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Prevent" title={HORIZON_TITLE} description={HORIZON_DESCRIPTION} />
      <Suspense fallback={<NavHold><HorizonSkeleton /></NavHold>}>
        <HorizonData />
      </Suspense>
    </section>
  );
}
