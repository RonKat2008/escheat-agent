import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NavHold } from "@/components/shell/NavHold";
import { ArrowRight } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { getTheaterRun, listTheaterRuns, pickDemoRun } from "@/lib/queries/theater";
import { listRuleStates } from "@/lib/rules/load";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { agentLabel } from "../runs/run-meta";
import { TheaterView } from "./TheaterView";

export const metadata: Metadata = { title: "Watch it work" };

const TITLE = "Watch it work";
const DESCRIPTION =
  "A replay of what the agents actually did, step by step, from a stored run. Model steps are blue; the law comes only from the versioned rules engine; every irreversible step stops at a person.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstState(): string | null {
  try {
    return listRuleStates()[0] ?? null;
  } catch {
    return null;
  }
}

/** No recorded runs: say so and point at the real actions that create one. Never a made-up run. */
function NoRuns() {
  const state = firstState();
  const links = [
    { href: state ? `/close-out/${state}` : "/reports", label: "Open the close-out runner" },
    { href: "/reports", label: "Generate a report" },
    { href: "/chat", label: "Ask in chat" },
  ];
  return (
    <div className="rounded-[10px] border border-line bg-ink-1 px-5 py-2" data-testid="theater-empty">
      <EmptyState
        title="No agent runs recorded yet"
        description="The theater only replays real stored runs, so there is nothing to show until an agent does something. Each of these creates a run:"
        action={
          <ul className="flex flex-wrap gap-2">
            {links.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
                  {l.label} <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        }
      />
    </div>
  );
}

function NotFoundRun({ id }: { id: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-ink-1 px-5 py-2" data-testid="theater-not-found">
      <EmptyState
        title="That run is not on record"
        description={`No stored run matches ${id.slice(0, 36)}. Pick a recorded run from Agent runs.`}
        action={
          <Link href="/runs" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Agent runs
          </Link>
        }
      />
    </div>
  );
}

async function TheaterData({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const sp = await searchParams;
  const { db, companyId } = await getCtx();
  const recent = await listTheaterRuns(db, companyId);
  const asked = typeof sp.run === "string" ? sp.run.trim() : "";
  if (asked && !UUID.test(asked)) return <NotFoundRun id={asked} />;
  const id = asked || pickDemoRun(recent)?.id;
  if (!id) return <NoRuns />;
  const run = await getTheaterRun(db, companyId, id);
  if (!run) return <NotFoundRun id={id} />;
  const others = recent.filter((r) => r.id !== run.id).map((r) => ({ ...r, label: agentLabel(r.agent) }));
  return <TheaterView key={run.id} initial={run} agentName={agentLabel(run.agent)} others={others} />;
}

export function TheaterSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the run">
      <div className="h-10 w-72 animate-pulse rounded-md bg-ink-2" />
      <div className="h-44 animate-pulse rounded-[10px] border border-line bg-ink-2" />
      <div className="h-64 animate-pulse rounded-[10px] border border-line bg-ink-2" />
    </div>
  );
}

export default function TheaterPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <PageHeader eyebrow="Agents" title={TITLE} description={DESCRIPTION} />
      <Suspense fallback={<NavHold><TheaterSkeleton /></NavHold>}>
        <TheaterData searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
