"use client";

import { useState } from "react";
import { FilePen } from "lucide-react";
import { postJson } from "@/components/b/api";
import { Money } from "@/components/primitives";
import { PRIMARY } from "@/components/ui/button";
import type { DraftCandidate, OutreachDraftsUi } from "@/lib/ask/cards/approval-ui-types";
import { draftOutreachPrompt } from "@/lib/ask/cards/registry";
import { cn } from "@/lib/utils";
import { ApprovalCardView } from "../ApprovalCardView";
import { AskButton, fmtDate, UnverifiedFlag } from "../parts";
import { ActionCardFrame, GhostLink } from "./frame";

type DraftResponse = { drafted: true; outreachId: string } | { drafted: false; reason: string };

/** One draftable item. "Request approval" drafts the letter through the existing route (POST /api/outreach/draft). */
function Candidate({ c }: { c: DraftCandidate }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setProblem(null);
    const r = await postJson<DraftResponse>("/api/outreach/draft", { staleItemId: c.staleItemId, channel: "letter" });
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setProblem(r.problems?.length ? r.problems.join("; ") : r.error);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5" data-testid="draft-candidate">
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-[13px] text-fg-1">
          {c.payeeName}
          {c.checkNumber ? <span className="num text-fg-3"> · #{c.checkNumber}</span> : null}
          {c.state ? <span className="text-fg-3"> · {c.state}</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          {c.windowEnd ? <span>Send by {fmtDate(c.windowEnd)}</span> : <span>Send-by date UNKNOWN</span>}
          {c.unverified ? <UnverifiedFlag compact /> : null}
        </p>
        {c.reason ? <p className="mt-1 text-xs text-fg-2">{c.reason}</p> : null}
      </div>
      <span className="num text-[13px] text-fg-1">
        <Money cents={c.amountCents} />
      </span>
      {result?.drafted ? (
        <span className="flex flex-wrap items-center gap-2" role="status" data-testid="draft-requested">
          <span className="text-[13px] text-fg-2">Drafted. It waits for approval; nothing is mailed.</span>
          {c.checkNumber ? <AskButton question={draftOutreachPrompt(c.checkNumber)}>Show the letter</AskButton> : null}
          <GhostLink href={`/approvals?sel=${encodeURIComponent(`o:${result.outreachId}`)}`}>Open in Approvals</GhostLink>
        </span>
      ) : result && !result.drafted ? (
        <span className="text-[13px] text-fg-2" role="status">
          Not drafted: {result.reason}
        </span>
      ) : c.decision === "draft" ? (
        <button
          type="button"
          onClick={request}
          disabled={busy}
          data-testid="draft-request-approval"
          className={cn(
            PRIMARY,
            "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98]",
          )}
        >
          {busy ? "Drafting…" : "Request approval"}
        </button>
      ) : null}
      {problem ? (
        <p role="alert" className="w-full text-[13px] text-pink-300">
          {problem}
        </p>
      ) : null}
    </li>
  );
}

/**
 * "Draft outreach" (docs/ASK-MODE.md slice 4): letters already drafted show the exact text the app composed (the
 * statutory wording comes only from the rule file) with the same inline approval as the chat approval card; items
 * that can be drafted get "Request approval", which drafts through the existing route so the letter waits in Approvals.
 */
export function DraftOutreachView({ asOf, query, drafts, candidates, notFound }: OutreachDraftsUi["props"]) {
  const open = candidates.filter((c) => !c.hasDraft);
  const nothing = drafts.length === 0 && open.length === 0;
  return (
    <ActionCardFrame
      testId="view-outreach-drafts"
      icon={<FilePen />}
      eyebrow="Draft outreach"
      title={query ? `Due-diligence letters for ${query}` : "Due-diligence letters"}
      meta={`As of ${fmtDate(asOf)}`}
      footer={<GhostLink href="/approvals">All approvals</GhostLink>}
    >
      {notFound ? <p className="px-4 py-4 text-[13px] text-fg-2 sm:px-5">{notFound}</p> : null}
      {nothing && !notFound ? (
        <p className="px-4 py-4 text-[13px] text-fg-2 sm:px-5">No letter waits for approval and no item is in an open due-diligence window right now.</p>
      ) : null}
      {drafts.length > 0 ? (
        <section aria-label="Drafted, waiting for approval" className="space-y-3 px-3 py-3 sm:px-4" data-testid="draft-previews">
          <h4 className="type-label px-1">Drafted, waiting for approval</h4>
          {drafts.map((d) => (
            <ApprovalCardView key={d.outreachId} {...d} />
          ))}
        </section>
      ) : null}
      {open.length > 0 ? (
        <section aria-label="Can be drafted" className="border-t border-line first:border-t-0" data-testid="draft-candidates">
          <h4 className="type-label px-4 pt-3 sm:px-5">Can be drafted</h4>
          <ul className="divide-y divide-line">
            {open.map((c) => (
              <Candidate key={c.staleItemId} c={c} />
            ))}
          </ul>
        </section>
      ) : null}
    </ActionCardFrame>
  );
}
