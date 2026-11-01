import Link from "next/link";
import { ArrowUpRight, ImageOff } from "lucide-react";
import { Money } from "@/components/primitives";
import type { PortalEvidence } from "@/lib/reports/portal-evidence";
import { cn } from "@/lib/utils";

/** What the filing agent actually put into the replica portal, from its stored run: the extracted summary and its latest screenshot. */
export function PortalEvidencePanel({ evidence, reportCount, reportCents }: { evidence: PortalEvidence; reportCount: number; reportCents: number }) {
  const { summary, shot } = evidence;
  const agrees = summary ? summary.itemCount === reportCount && summary.totalCents === reportCents : null;
  return (
    <div className="mb-5 grid gap-5 border-y border-line py-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-testid="portal-evidence">
      <figure className="min-w-0">
        {shot ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
            <img src={shot.src} alt={`Latest screenshot from the filing agent: ${shot.label}`} width={640} height={400} className="h-auto w-full rounded-md border border-line bg-ink-1" data-testid="portal-screenshot" />
            <figcaption className="mt-1.5 text-xs text-fg-3">Agent screenshot: {shot.label}</figcaption>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg-3">
            <ImageOff className="size-4" aria-hidden /> This run stored no screenshot.
          </p>
        )}
      </figure>
      <div className="min-w-0 text-sm">
        <h4 className="text-[13px] text-fg-2">Portal summary (extracted by the agent)</h4>
        {summary ? (
          <>
            <p className="num mt-1.5 text-fg-1" data-testid="portal-summary">
              {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"}, <Money cents={summary.totalCents} />
            </p>
            <p className={cn("mt-1 text-xs", agrees ? "text-blue-300" : "text-pink-400")}>
              {agrees ? "Matches this report's item count and total." : "Does not match this report. Do not approve."}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-fg-3">The run did not record a portal summary.</p>
        )}
        <Link href={`/runs/${evidence.runId}`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Open the full run <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
