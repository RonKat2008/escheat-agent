import { and, desc, eq, inArray } from "drizzle-orm";
import { AnimatedNumber, EmptyState } from "@/components/primitives";
import { InstrumentLabel } from "@/components/primitives/v3";
import { RecoveryFlow } from "@/components/viz/recovery-flow/RecoveryFlow";
import type { RecoveryFlowRow } from "@/components/viz/recovery-flow/flow-model";
import { agentRuns, companies } from "@/db/schema";
import { CLAIM_AGENT, RECOVERY_AGENT } from "@/lib/browser-agents/runs";
import { lastSearchedByState } from "@/lib/recoveries/searched";
import { listRecoveries } from "@/lib/recoveries/service";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { ClaimCard } from "./ClaimCard";
import { ClaimGhost } from "./ClaimGhost";
import { PortalStrip, type PortalStat } from "./PortalStrip";
import { RunRecoveryButton } from "./RunRecoveryButton";

const PORTALS = ["CA", "DE", "TX"] as const;

export async function RecoveriesView() {
  const { db, companyId } = await getCtx();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const list = (await listRecoveries(db, companyId));
  const runs = await db
    .select({ id: agentRuns.id, status: agentRuns.status, input: agentRuns.input, trace: agentRuns.trace, startedAt: agentRuns.startedAt })
    .from(agentRuns)
    .where(and(eq(agentRuns.companyId, companyId), inArray(agentRuns.agent, [RECOVERY_AGENT, CLAIM_AGENT])))
    .orderBy(desc(agentRuns.startedAt))
    .limit(30);
  // Runs still in flight are re-attached on load, so progress survives a reload (the run is read from the DB, not from component state).
  const activeSearchId = runs.find((r) => r.status === "running" && (r.input as { states?: unknown } | null)?.states)?.id ?? null;
  const activeClaimRuns = new Map(runs.filter((r) => r.status === "running").map((r) => [(r.input as { recoveryId?: string } | null)?.recoveryId ?? "", r.id]));
  const open = list.filter((r) => !["rejected"].includes(r.status));
  const total = open.reduce((s, r) => s + r.amountCents, 0);

  // Straight from the stored rows: status and whether an approval exists. Nothing is inferred or back-filled.
  const flowRows: RecoveryFlowRow[] = list.map((r) => ({ state: r.state, status: r.status, amountCents: r.amountCents, approved: Boolean(r.approvalId) }));

  const searched = lastSearchedByState(
    runs.filter((r) => (r.input as { states?: unknown } | null)?.states),
    PORTALS,
  );
  const portals: PortalStat[] = PORTALS.map((state) => {
    const found = list.filter((r) => r.state === state).map((r) => r.foundAt.getTime());
    // A found property means the state was searched; per-state trace steps cover searches that found nothing.
    const foundLatest = found.length ? new Date(Math.max(...found)).toISOString() : null;
    const last = [searched[state], foundLatest].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return { state, matches: open.filter((r) => r.state === state).length, lastSearched: last };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <InstrumentLabel as="p" className="mb-2">
            Found for {company?.name ?? "your company"}
          </InstrumentLabel>
          <p
            className={cn("money-flow money-flow-hero num text-[clamp(2.75rem,1.6rem+3.6vw,4.5rem)] leading-none font-medium tracking-[-0.04em]", total > 0 ? "text-blue-400" : "text-fg-3")}
            data-testid="recovery-total"
          >
            <AnimatedNumber value={total} currency countUp="recoveries-total" />
          </p>
        </div>
        <RunRecoveryButton hasResults={open.length > 0} initialRunId={activeSearchId} />
      </div>
      <p className="-mt-5 text-sm text-fg-2">
        {open.length > 0
          ? `${open.length} match${open.length > 1 ? "es" : ""} on the replica state portals. You approve every claim.`
          : "Nothing found yet. Run the search to check the CA, DE and TX replica portals."}
      </p>

      <RecoveryFlow variant="recovery" rows={flowRows} />

      <PortalStrip portals={portals} />

      {list.length === 0 ? (
        <section aria-labelledby="claims-h" className="space-y-5">
          <EmptyState
            className="px-0 py-0"
            title="No claims yet"
            description={`The recovery agent searches each replica portal for ${company?.name ?? "your company"} and the name variants states commonly record it under (punctuation, abbreviations, Inc vs LLC). Matches appear here with the variant, a confidence score and a claim to approve. It never searches a real state system.`}
          />
          <h2 id="claims-h" className="sr-only">
            Claims
          </h2>
          <ClaimGhost />
        </section>
      ) : (
        <ul className="space-y-4" aria-label="Found money">
          {list.map((r, i) => (
            <li key={r.id} className="es-rise" style={{ ["--i" as string]: i }}>
              <ClaimCard recovery={r} companyName={company?.name ?? ""} initialRunId={activeClaimRuns.get(r.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
