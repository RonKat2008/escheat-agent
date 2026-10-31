import { and, desc, eq } from "drizzle-orm";
import { AnimatedNumber, EmptyState } from "@/components/primitives";
import { agentRuns, companies } from "@/db/schema";
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
    .select({ input: agentRuns.input, startedAt: agentRuns.startedAt })
    .from(agentRuns)
    .where(and(eq(agentRuns.companyId, companyId), eq(agentRuns.agent, "recovery-agent")))
    .orderBy(desc(agentRuns.startedAt))
    .limit(20);
  const open = list.filter((r) => !["rejected"].includes(r.status));
  const total = open.reduce((s, r) => s + r.amountCents, 0);

  const portals: PortalStat[] = PORTALS.map((state) => {
    const last = runs.find((r) => {
      const states = (r.input as { states?: string[] } | null)?.states;
      return !states || states.includes(state);
    });
    const found = list.filter((r) => r.state === state).map((r) => r.foundAt);
    const foundLatest = found.length ? new Date(Math.max(...found.map((d) => d.getTime()))) : null;
    const searched = last?.startedAt ?? foundLatest;
    return { state, matches: open.filter((r) => r.state === state).length, lastSearched: searched ? searched.toISOString() : null };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <p className="mb-2 text-[13px] text-fg-2">Found for {company?.name ?? "your company"}</p>
          <p
            className={cn("money-flow money-flow-hero num text-[clamp(2.75rem,1.6rem+3.6vw,4.5rem)] leading-none font-medium tracking-[-0.04em]", total > 0 ? "text-fg-1" : "text-fg-3")}
            data-testid="recovery-total"
          >
            <AnimatedNumber value={total} currency countUp="recoveries-total" />
          </p>
        </div>
        <RunRecoveryButton hasResults={open.length > 0} />
      </div>
      <p className="-mt-5 text-sm text-fg-2">
        {open.length > 0
          ? `${open.length} match${open.length > 1 ? "es" : ""} on the replica state portals. You approve every claim.`
          : "Nothing found yet. Run the search to check the CA, DE and TX replica portals."}
      </p>

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
              <ClaimCard recovery={r} companyName={company?.name ?? ""} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
