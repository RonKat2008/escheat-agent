import { CheckCircle2, Info } from "lucide-react";
import {
  DateCell,
  EmptyState,
  Money,
  SourceLink,
  StatusPill,
  UnknownBadge,
  UnverifiedBadge,
  UnverifiedBanner,
} from "@/components/primitives";
import { DEADLINE_LABEL, formatDate, formatSpan, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { Explanation, TimelineEvent } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { DraftOutreach } from "./draft-outreach";
import { MarkResolved } from "./mark-resolved";

interface Node {
  key: string;
  label: string;
  note?: string;
  date: string | null;
  status: "ok" | "unknown" | "not_applicable";
  verified: boolean;
  ruleVersion: string | null;
  rulePaths: string[];
  sources: { url: string; title: string; quote: string }[];
  notes: string[];
  legal: boolean;
}

type NodeState = "past" | "next" | "future" | "unknown";

function dedupeSources(s: Node["sources"]) {
  const seen = new Set<string>();
  return s.filter((x) => {
    const k = `${x.url}|${x.quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildNodes(ex: Explanation): Node[] {
  const t = new Map<string, TimelineEvent>(ex.timeline.map((e) => [e.key, e]));
  const fromEv = (key: TimelineEvent["key"], label: string, note?: string): Node => {
    const e = t.get(key);
    return {
      key,
      label,
      ...(note ? { note } : {}),
      date: e?.date ?? null,
      status: e?.status ?? "unknown",
      verified: e?.verified ?? false,
      ruleVersion: e?.ruleVersion ?? null,
      rulePaths: e?.rulePaths ?? [],
      sources: dedupeSources(e?.sources ?? []),
      notes: e?.notes ?? [],
      legal: true,
    };
  };
  const plain = (key: string, label: string, date: string | null, note: string): Node => ({
    key, label, note, date, status: date ? "ok" : "unknown", verified: true, ruleVersion: null, rulePaths: [], sources: [], notes: [], legal: false,
  });
  const stage = ex.item.reportStage ? ` (${ex.item.reportStage})` : "";
  return [
    plain("issued", ex.ledger.lastActivityDate && ex.ledger.lastActivityDate !== ex.ledger.issueDate ? "Last activity" : "Issued", ex.ledger.lastActivityDate ?? ex.ledger.issueDate, "From the ledger"),
    plain("stale", "Stale", ex.item.staleSince, "Business threshold, not law"),
    fromEv("presumed_abandoned", "Presumed abandoned", "Dormancy period under the owner state's law"),
    fromEv("dd_window_start", `Due-diligence window opens`),
    fromEv("dd_window_end", "Due-diligence window closes"),
    fromEv("report_due", `Report due${stage}`),
    fromEv("remit_due", "Remit due"),
  ];
}

/** Past nodes are solid blue, the next one is a pink ring, future ones hollow. Unknown is a dim hollow ring. */
const NODE_DOT: Record<NodeState, string> = {
  past: "bg-blue-500",
  next: "bg-ink-1 ring-2 ring-pink-500",
  future: "bg-ink-1 ring-1 ring-fg-4",
  unknown: "bg-ink-1 ring-1 ring-fg-3",
};

function NodeRow({ n, state, last, i }: { n: Node; state: NodeState; last: boolean; i: number }) {
  const sources = n.sources.slice(0, 3);
  return (
    <li className="es-rise relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-node={n.key} style={{ ["--i" as string]: i }}>
      {!last ? <span aria-hidden className={cn("absolute top-[18px] bottom-0 left-[7.5px] w-px", state === "past" ? "bg-blue-500/45" : "bg-line-hover")} /> : null}
      <span className="relative mt-[5px] grid size-4 place-items-center">
        <span aria-hidden className={cn("size-2 rounded-full", NODE_DOT[state])} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cn("text-[13px] font-medium", state === "past" || state === "next" ? "text-fg-1" : "text-fg-2")}>
            {n.label}
            {state === "next" ? <span className="ml-2 text-xs font-normal text-pink-400">Next</span> : null}
          </span>
          <span className="flex items-center gap-2">
            {n.date && n.legal && !n.verified ? <UnverifiedBadge compact /> : null}
            {n.date ? <DateCell date={n.date} className="text-[13px] text-fg-2" /> : n.legal ? <UnknownBadge /> : null}
          </span>
        </div>
        {n.note ? <p className="mt-0.5 text-xs text-fg-3">{n.note}</p> : null}
        {n.legal && n.ruleVersion ? (
          <p className="mt-1 flex min-w-0 gap-1.5 font-mono text-[11px] text-fg-3" title={n.rulePaths.join(", ")}>
            <span className="shrink-0">rule {n.ruleVersion}</span>
            {n.rulePaths[0] ? <span className="min-w-0 truncate">{n.rulePaths[0]}</span> : null}
            {n.rulePaths.length > 1 ? <span className="shrink-0">+{n.rulePaths.length - 1}</span> : null}
          </p>
        ) : null}
        {n.legal && n.status === "unknown" && n.notes[0] ? <p className="mt-1 text-xs text-fg-2 italic">{n.notes[0]}</p> : null}
        {sources.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {sources.map((s) => (
              <SourceLink key={`${s.url}${s.quote}`} {...s} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const H3 = "mb-3 text-[13px] font-medium text-fg-1";
const SECTION = "border-t border-line px-5 py-5";

const BASIS_COPY: Record<string, string> = {
  address: "Owner's last known address is in this state. Under Texas v. New Jersey, unclaimed property escheats to the state of the owner's last known address.",
  incorporation: "No usable owner address on file. Under Texas v. New Jersey, the property goes to the holder's state of incorporation when the owner's address is unknown.",
};

const HOLDER_TASK_COPY: Record<string, string> = {
  verify_and_reissue: "Verify the owner's identity and the original payment, then reissue it. The owner's claim is unverified.",
  verify_cleared: "Check your bank records for this check. The owner's claim that it was cashed is unverified.",
  update_address: "The owner supplied a new mailing address. Review it before the next letter.",
};

type OwnerResponse = { intent?: string; holderTask?: string; at?: string };

/** Holder task after a public owner response, and the authenticated "Mark resolved (paid)" action (H2). */
function ResolutionSection({ ex }: { ex: Explanation }) {
  const it = ex.item;
  const cls = (it.classification ?? {}) as { ownerResponse?: OwnerResponse; resolution?: { by?: string; at?: string } };
  const resp = cls.ownerResponse;
  const terminal = it.status === "resolved_paid" || it.status === "remitted";
  if (!resp && !cls.resolution && terminal) return null;
  return (
    <section aria-labelledby="res-h" className={SECTION} data-testid="resolution-section">
      <h3 id="res-h" className={H3}>
        Owner response and resolution
      </h3>
      {resp ? (
        <div className="mb-3 space-y-1 text-[13px] text-fg-1" data-testid="holder-task">
          <p>
            Owner replied via the response link{resp.at ? <span className="text-fg-3"> on {resp.at.slice(0, 10)}</span> : null}:{" "}
            <span className="font-medium">{resp.intent?.replace(/_/g, " ")}</span>.
          </p>
          {resp.holderTask ? <p className="text-fg-2">Holder task: {HOLDER_TASK_COPY[resp.holderTask] ?? resp.holderTask}</p> : null}
        </div>
      ) : null}
      {it.status === "resolved_paid" ? (
        <p className="flex items-center gap-2 text-[13px] text-fg-1" data-testid="resolved-note">
          <CheckCircle2 className="size-4 shrink-0 text-blue-500" strokeWidth={1.75} aria-hidden />
          <span>
            Resolved (paid){cls.resolution?.by ? <> by {cls.resolution.by}</> : null}
            {cls.resolution?.at ? <span className="text-fg-3"> on {cls.resolution.at.slice(0, 10)}</span> : null}.
          </span>
        </p>
      ) : terminal ? null : (
        <MarkResolved staleItemId={it.id} status={it.status as Parameters<typeof MarkResolved>[0]["status"]} />
      )}
    </section>
  );
}

function ownerBasis(basis: string | null | undefined): string {
  if (basis === "incorporation") return "state of incorporation";
  if (basis === "address") return "owner address";
  return "unknown basis";
}

export function DrawerBody({ ex }: { ex: Explanation | null }) {
  if (!ex) return <EmptyState className="p-5" title="Item not found" description="It may have been removed. Close this panel and pick another row." />;
  const it = ex.item;
  const nodes = buildNodes(ex);
  const dated = nodes.filter((n) => n.date);
  const isClosed = it.status === "resolved_paid" || it.status === "remitted";
  const nextKey = isClosed ? undefined : dated.find((n) => n.legal && n.date! >= ex.asOf)?.key ?? dated.find((n) => n.date! >= ex.asOf)?.key;
  const cls = (it.classification ?? {}) as Record<string, unknown>;
  const method = String(cls.method ?? "unknown");
  const confidence = typeof cls.confidence === "number" ? cls.confidence : null;
  const rationale = typeof cls.rationale === "string" ? cls.rationale : null;
  const isHeuristic = method.toLowerCase() === "heuristic" || /^HEURISTIC/.test(rationale ?? "");
  return (
    <div className="pb-8">
      <header className="px-5 pt-5 pb-5">
        <p className="pr-10 text-[13px] text-fg-3">
          {it.checkNumber ? <span className="font-mono text-fg-2">#{it.checkNumber}</span> : "No check number"}
          <span className="ml-2">
            {PROPERTY_TYPE_LABEL[it.propertyType]}, issued {formatSpan(it.ageDays)} ago
          </span>
        </p>
        <h2 className="mt-1.5 pr-10 text-xl leading-7 font-semibold tracking-[-0.015em] text-fg-1">{it.payeeName}</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Money cents={it.amount.cents} className="text-[28px] leading-none font-medium tracking-[-0.02em] text-fg-1" />
          <StatusPill status={it.status} />
        </div>
      </header>

      <ResolutionSection ex={ex} />

      <section aria-labelledby="owner-h" className={SECTION}>
        <h3 id="owner-h" className={H3}>
          Owner and state
        </h3>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-lg font-medium text-fg-1">{it.ownerState ?? "Unknown"}</span>
          <span className="text-[13px] text-fg-3">by {ownerBasis(it.ownerStateBasis)}</span>
        </div>
        <p className="text-[13px] text-fg-2">
          {it.ownerStateBasis ? BASIS_COPY[it.ownerStateBasis] : "The owner state could not be determined, so no state rules apply yet."}
        </p>
        <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-fg-3">Payee</dt>
          <dd className="text-fg-1">
            {ex.payee?.canonicalName ?? it.payeeName}
            {ex.payee && ex.payee.aliases.length > 0 ? <span className="text-fg-3">, also {ex.payee.aliases.slice(0, 2).join(", ")}</span> : null}
          </dd>
          <dt className="text-fg-3">Address</dt>
          <dd className="text-fg-1">{ex.payee?.address || ex.ledger.address || <span className="text-fg-3 italic">None on file</span>}</dd>
          {ex.ledger.memo ? (
            <>
              <dt className="text-fg-3">Memo</dt>
              <dd className="text-fg-1">{ex.ledger.memo}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="tl-h" className={SECTION}>
        <h3 id="tl-h" className={H3}>
          {isClosed ? "Timeline (history only)" : "Timeline"}
        </h3>
        {it.dependsOnUnverified && !isClosed ? (
          <UnverifiedBanner className="mb-5">
            Dates below depend on rule values nobody has verified yet. They stay provisional until a human checks them in Rules.
          </UnverifiedBanner>
        ) : null}
        <ol data-testid="item-timeline">
          {nodes.map((n, i) => {
            const state: NodeState = !n.date ? "unknown" : n.key === nextKey ? "next" : n.date < ex.asOf ? "past" : "future";
            return <NodeRow key={n.key} n={n} state={state} last={i === nodes.length - 1} i={i} />;
          })}
        </ol>
        {isClosed ? (
          <p className="mt-4 text-xs text-fg-3">This item is closed, so no legal dates are pending. Dates above are shown for the record.</p>
        ) : it.nextDeadline ? (
          <p className="mt-4 text-xs text-fg-3">
            Next legal date: {DEADLINE_LABEL[it.nextDeadline.kind]}, <span className="num text-fg-2">{formatDate(it.nextDeadline.date)}</span>.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="cls-h" className={SECTION}>
        <h3 id="cls-h" className={H3}>
          Classification
        </h3>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <span className="text-fg-1">{isHeuristic ? "Heuristic" : method}</span>
          <span className="text-fg-2">{PROPERTY_TYPE_LABEL[it.propertyType]}</span>
          {confidence !== null ? (
            <span className="num text-fg-3">{Math.round(confidence * 100)}% confidence</span>
          ) : (
            <span className="text-fg-3">no model confidence</span>
          )}
          {it.needsReview ? <span className="inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-xs font-medium text-black">Needs review</span> : null}
        </div>
        {rationale ? <p className="text-[13px] text-fg-2">{rationale}</p> : null}
        {ex.warnings.length > 0 ? (
          <ul className="mt-4 space-y-1.5 text-xs text-fg-2">
            {ex.warnings.slice(0, 4).map((w) => (
              <li key={w} className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-blue-400" strokeWidth={1.75} aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="out-h" className={SECTION}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="out-h" className="text-[13px] font-medium text-fg-1">
            Outreach
          </h3>
          <DraftOutreach staleItemId={it.id} />
        </div>
        {ex.outreach.length === 0 ? (
          <p className="text-[13px] text-fg-2">No outreach yet. Drafting a letter queues it for your approval; nothing is sent automatically.</p>
        ) : (
          <ul className="border-t border-line">
            {ex.outreach.map((o) => (
              <li key={o.id} className="flex items-center gap-3 border-b border-line py-2 text-[13px]">
                <span className="w-14 text-fg-1 capitalize">{o.channel}</span>
                <StatusPill status={o.status} />
                <span className="num ml-auto truncate text-xs text-fg-3">{formatDate((o.sentAt ?? o.createdAt).slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
