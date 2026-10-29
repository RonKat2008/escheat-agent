import { eq } from "drizzle-orm";
import { EmptyState, Money } from "@/components/primitives";
import { companies } from "@/db/schema";
import { listRecoveries } from "@/lib/recoveries/service";
import { getCtx } from "@/lib/ui/ctx";
import { ClaimCard } from "./ClaimCard";
import { RunRecoveryButton } from "./RunRecoveryButton";

export async function RecoveriesView() {
  const { db, companyId } = await getCtx();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const list = await listRecoveries(db, companyId);
  const open = list.filter((r) => !["rejected"].includes(r.status));
  const total = open.reduce((s, r) => s + r.amountCents, 0);
  const states = [...new Set(open.map((r) => r.state))];

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-[16px] border border-strong bg-surface p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_180px_at_0%_0%,rgba(34,197,94,0.08),transparent)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Found for {company?.name ?? "your company"}</p>
            <p className={`font-mono text-[clamp(2.5rem,1.4rem+4.2vw,3.75rem)] leading-none font-semibold tracking-[-0.02em] tabular-nums ${total > 0 ? "text-resolved" : "text-muted-foreground"}`} data-testid="recovery-total">
              <Money cents={total} />
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {open.length > 0
                ? `Replica state search · ${open.length} match${open.length > 1 ? "es" : ""} in ${states.join(", ")}`
                : "No matches yet. Run the search to check the CA, DE and TX replica portals."}
            </p>
          </div>
          <RunRecoveryButton hasResults={open.length > 0} />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-surface p-7">
          <EmptyState
            className="p-0"
            title="Nothing found yet"
            description={`The recovery agent searches each replica state portal for ${company?.name ?? "your company"} and the name variants states commonly record it under (punctuation, abbreviations, Inc vs LLC). Matches appear here with the name variant and a confidence score. It only ever searches replica portals, never a real state system.`}
          />
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Found money">
          {list.map((r) => (
            <li key={r.id}>
              <ClaimCard recovery={r} companyName={company?.name ?? ""} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
