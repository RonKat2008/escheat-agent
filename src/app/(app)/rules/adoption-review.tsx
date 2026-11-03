"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, FileText, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { getJson, postJson, type ApiFailure } from "@/components/b/api";
import { InstrumentLabel, UnknownValue } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdoptionPreview } from "@/lib/rules/adopt";
import { cn } from "@/lib/utils";
import { addressedToHolder, canApprove, diffSegments, impactCopy, quoteSegments } from "./adoption-model";

interface AdoptResponse {
  version: string;
  value: string;
  verifiedBy: string;
  transitions: number;
}

function Diff({ preview }: { preview: AdoptionPreview }) {
  const after = preview.after!.value;
  const before = typeof preview.before.value === "string" ? preview.before.value : null;
  const segs = diffSegments(before, after);
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="adopt-diff">
      <div className="min-w-0 rounded-md border border-dashed border-fg-4 bg-ink-1 p-3">
        <InstrumentLabel as="p">Before</InstrumentLabel>
        <div className="mt-2 text-[13px]">
          {before === null ? <UnknownValue label="Unknown" reason="No value has been confirmed for this rule" /> : <span className="text-fg-2 line-through decoration-fg-3/60">{before}</span>}
        </div>
      </div>
      <div className="min-w-0 rounded-md border border-blue-700 bg-ink-1 p-3">
        <InstrumentLabel as="p">After (verbatim, not editable)</InstrumentLabel>
        <p className="mt-2 text-[13px] leading-5 break-words text-fg-1" data-testid="adopt-after">
          {segs.map((s, i) =>
            s.kind === "removed" ? (
              <del key={i} className="text-fg-3">
                {s.text}
              </del>
            ) : s.kind === "added" ? (
              <ins key={i} className="bg-blue-900 text-blue-300 no-underline">
                {s.text}
              </ins>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}

function QuoteInSource({ preview }: { preview: AdoptionPreview }) {
  const source = preview.proposal.sources[0];
  if (!source || !preview.proposal.quote || !preview.after) return null;
  const others = preview.citations.filter((c) => c.url !== source.url);
  return (
    <section aria-labelledby="adopt-src-h" className="min-w-0">
      <InstrumentLabel as="h3" id="adopt-src-h">
        Where the text comes from
      </InstrumentLabel>
      <blockquote className="mt-2 border-l-2 border-blue-500 pl-3 text-[13px] leading-5 break-words text-fg-2" data-testid="adopt-quote">
        &ldquo;
        {quoteSegments(preview.proposal.quote, preview.after.value).map((s, i) =>
          s.match ? (
            <mark key={i} className="rounded-[2px] bg-blue-900 text-blue-300">
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        &rdquo;
      </blockquote>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="adopt-source-link"
        className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-[13px] text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:text-blue-300"
      >
        <FileText className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 truncate">{source.title || source.url}</span>
        <ExternalLink className="size-3 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <p className="mt-1 text-xs text-fg-3">
        The highlighted words are copied character for character from this official source. {others.length > 0 ? `${others.length} other cited source${others.length > 1 ? "s stay" : " stays"} on the rule.` : null}
      </p>
    </section>
  );
}

function Impact({ preview }: { preview: AdoptionPreview }) {
  const copy = impactCopy(preview.state, preview.impact);
  if (!copy) return null;
  return (
    <section aria-labelledby="adopt-impact-h" data-testid="adopt-impact" className="min-w-0">
      <InstrumentLabel as="h3" id="adopt-impact-h">
        What changes
      </InstrumentLabel>
      <p className="mt-2 text-[13px] text-fg-1">{copy.headline}</p>
      {copy.reasons.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-fg-2">
          {copy.reasons.map((r) => (
            <li key={r}>Still blocked, {r}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HolderWarning({ text }: { text: string }) {
  const holder = addressedToHolder(text);
  return (
    <p role="note" data-testid="adopt-warning" className="flex gap-2 rounded-md border border-pink-700 bg-pink-900/40 px-3 py-2.5 text-[13px] leading-5 text-fg-1">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
      <span>
        {holder ? (
          <>
            This official text is addressed to the holder (&ldquo;You (the holder)&rdquo;), not to the owner. It will appear{" "}
            <strong className="font-medium">word for word</strong> in every owner letter for this state.
          </>
        ) : (
          <>
            This text will appear <strong className="font-medium">word for word</strong> in every owner letter for this state.
          </>
        )}{" "}
        Approve only if that is what you want owners to read. Not legal advice.
      </span>
    </p>
  );
}

/**
 * R3-05 "Use official text": a human reviews the exact sentence an official source requires (before/after, the
 * quote highlighted in its source, the outreach impact) and approves it under their name. The text is not editable;
 * the server re-checks the version, hash and exact text before writing a new rule version.
 */
export function AdoptionReview({ state, path, label, gateSuffix }: { state: string; path: string; label: string; gateSuffix: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AdoptionPreview | null>(null);
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [approver, setApprover] = useApprover();
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const url = `/api/rules/${state}/adopt`;

  async function openReview() {
    setOpen(true);
    setFailure(null);
    setLoadFailure(null);
    setLoading(true);
    const r = await getJson<AdoptionPreview>(`${url}?path=${encodeURIComponent(path)}`);
    setLoading(false);
    if (!r.ok) return setLoadFailure(r);
    setPreview(r.data);
  }

  function approve() {
    if (!preview?.after) return;
    setFailure(null);
    const body = { path, approvedBy: approver.trim(), expectedVersion: preview.expectedVersion, expectedSha256: preview.expectedSha256, proposedText: preview.after.value };
    startTransition(async () => {
      const r = await postJson<AdoptResponse>(url, body);
      if (!r.ok) return setFailure(r);
      toast.success(`${label} verified by ${approver.trim()}.`, { description: `Saved as ${r.data.version}${r.data.transitions ? `; ${r.data.transitions} status changes` : ""}` });
      setOpen(false);
      router.refresh();
    });
  }

  const ready = Boolean(preview?.after);
  const nameOk = canApprove(approver);
  return (
    <>
      <Button size="sm" onClick={openReview} data-testid="adopt-open">
        <FileText className="size-3.5" aria-hidden />
        Use official text
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="adopt-dialog">
          <DialogHeader>
            <DialogTitle>Use the official text for {label.toLowerCase()}?</DialogTitle>
            <DialogDescription>{preview ? preview.before.status.text : `Loading the official text for ${state}…`}</DialogDescription>
          </DialogHeader>
          {loading ? <p className="text-[13px] text-fg-3">Loading the source, the proposed text and its impact…</p> : null}
          {loadFailure ? <ApiProblem failure={loadFailure} /> : null}
          {preview && !preview.after ? (
            <p className="text-[13px] text-fg-2">No official source quotes text for this rule, so there is nothing to adopt. It needs research and a person&apos;s approval.</p>
          ) : null}
          {preview?.after ? (
            <div className="grid min-w-0 gap-5">
              <HolderWarning text={preview.after.value} />
              <Diff preview={preview} />
              <QuoteInSource preview={preview} />
              <Impact preview={preview} />
              <div className="grid gap-1.5">
                <ApproverField value={approver} onChange={setApprover} className="sm:max-w-xs" />
                {!nameOk ? (
                  <p className="text-[13px] text-pink-400" data-testid="adopt-name-required">
                    Enter your name (2 or more characters) to approve. It is recorded on the approval and the new rule version.
                  </p>
                ) : gateSuffix ? (
                  <p className="flex gap-1.5 text-xs text-fg-3" data-testid="gate-disabled-note">
                    <ShieldAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span>
                      Recorded as &ldquo;{approver.trim()} {gateSuffix}&rdquo;.
                    </span>
                  </p>
                ) : null}
              </div>
              {failure ? <ApiProblem failure={failure} /> : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={approve} disabled={!ready || !nameOk || pending} data-testid="adopt-approve" className={cn(!ready && "hidden")}>
              {pending ? "Saving…" : "Approve official text"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
