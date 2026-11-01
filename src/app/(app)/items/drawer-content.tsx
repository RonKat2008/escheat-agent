import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, ChevronRight, Info } from "lucide-react";
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
import type { Explanation } from "@/lib/queries";
import { ruleFieldLabel } from "@/lib/rules/derivation";
import { cn } from "@/lib/utils";
import { DraftOutreach } from "./draft-outreach";
import { MarkResolved } from "./mark-resolved";
import { buildNodes, nodeState, numberSources, todayIndex, type NodeState, type NumberedSources, type TimelineNode } from "./timeline";

/** Past nodes are solid blue, the next one is a pink ring, future ones hollow. Unknown is a dim hollow ring. */
const NODE_DOT: Record<NodeState, string> = {
  past: "bg-blue-500",
  next: "bg-ink-1 ring-2 ring-pink-500",
  future: "bg-ink-1 ring-1 ring-fg-4",
  unknown: "bg-ink-1 ring-1 ring-fg-3",
};

const RAIL = "absolute top-[18px] bottom-0 left-[7.5px] w-px";

/**
 * Everything behind a date, folded away: the engine's derivation, the business-day roll, the rule fields used and
 * numbered references into the timeline's single Sources list. Closed by default so the timeline reads as dates.
 */
function HowComputed({ n, refs }: { n: TimelineNode; refs: number[] }) {
  const hasRules = Boolean(n.ruleVersion) && n.rulePaths.length > 0;
  if (n.derivation.length === 0 && !n.roll && !hasRules && refs.length === 0) return null;
  const meta = [
    hasRules ? `${n.rulePaths.length} rule ${n.rulePaths.length === 1 ? "value" : "values"}` : null,
    refs.length > 0 ? `${refs.length === 1 ? "source" : "sources"} ${refs.join(", ")}` : null,
  ].filter(Boolean);
  return (
    <details className="group/how mt-1" data-testid="node-rules">
      <summary className="-ml-1 inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm px-1 text-xs text-fg-3 transition-colors duration-150 select-none hover:text-fg-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform duration-150 group-open/how:rotate-90 motion-reduce:transition-none" strokeWidth={1.5} aria-hidden />
        How this date is set
        {meta.length > 0 ? <span>· {meta.join(" · ")}</span> : null}
      </summary>
      <div className="es-disclose mt-2 space-y-2.5 border-l border-line-hover pl-3 text-xs leading-5 text-fg-2">
        {n.derivation.length > 0 ? (
          <ol className="space-y-0.5 text-pretty" data-testid="node-derivation" aria-label={`How ${n.label.toLowerCase()} is computed`}>
            {n.derivation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        ) : null}
        {n.roll ? (
          <p className="text-pretty" data-testid="node-roll">
            <span className="font-medium text-fg-1">Moved by the business-day rule. </span>
            {n.roll}
          </p>
        ) : null}
        {hasRules ? (
          <div>
            <p className="text-fg-3">
              Rule values used, rule file <span className="font-mono text-[11px]">{n.ruleVersion}</span>
            </p>
            <ul className="mt-1 space-y-1">
              {n.rulePaths.map((p) => (
                <li key={p} className="min-w-0">
                  <span className="text-fg-2">{ruleFieldLabel(p)}</span>
                  <span className="ml-1.5 font-mono text-[11px] break-all text-fg-3">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {refs.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-fg-3">
            Cited:
            {refs.map((r) => (
              <a
                key={r}
                href={`#tl-src-${r}`}
                aria-label={`Source ${r}, listed under Sources`}
                className="num inline-grid h-5 min-w-5 place-items-center rounded-[4px] border border-line-hover px-1 text-[11px] text-blue-300 transition-colors duration-150 hover:border-blue-400 hover:text-fg-1"
              >
                {r}
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function NodeRow({ n, state, last, i, refs }: { n: TimelineNode; state: NodeState; last: boolean; i: number; refs: number[] }) {
  // Notes are only shown when there is no derivation to explain the date (e.g. unknown, or a stale stored date).
  const notes = n.legal && n.derivation.length === 0 ? n.notes : [];
  return (
    <li className="es-rise relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-node={n.key} style={{ ["--i" as string]: i }}>
      {!last ? <span aria-hidden className={cn(RAIL, state === "past" ? "bg-blue-500/45" : "bg-line-hover")} /> : null}
      <span className="relative mt-[5px] grid size-4 place-items-center">
        <span aria-hidden className={cn("size-2 rounded-full", NODE_DOT[state])} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={cn("text-[13px] font-medium", state === "past" || state === "next" ? "text-fg-1" : "text-fg-2")}>
            {n.label}
            {state === "next" ? <span className="ml-2 text-xs font-normal text-pink-400">Next deadline</span> : null}
          </span>
          <span className="flex items-center gap-2">
            {n.date && n.legal && !n.verified ? <UnverifiedBadge compact /> : null}
            {n.date ? <DateCell date={n.date} className={cn("text-[13px]", state === "next" ? "text-fg-1" : "text-fg-2")} /> : n.legal ? <UnknownBadge /> : null}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-3">{n.meaning}</p>
        {n.roll ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-2">
            <CalendarClock className="size-3.5 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
            Moved to the next business day
          </p>
        ) : null}
        {notes.length > 0 ? <p className={cn("mt-1 text-xs text-fg-2", n.status === "unknown" && "italic")}>{notes.join(" ")}</p> : null}
        <HowComputed n={n} refs={refs} />
      </div>
    </li>
  );
}

/** The divider between what has happened and what is coming. */
function TodayRow({ asOf, last }: { asOf: string; last: boolean }) {
  return (
    <li className="es-rise relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-testid="timeline-today">
      {!last ? <span aria-hidden className={cn(RAIL, "top-[12px] bg-line-hover")} /> : null}
      <span aria-hidden className="relative grid h-4 place-items-center">
        <span className="h-[2px] w-3 rounded-full bg-blue-400" />
      </span>
      <p className="flex min-w-0 items-center gap-2 text-xs">
        <span className="font-medium text-blue-300">Today</span>
        <time dateTime={asOf} className="num text-fg-3">
          {formatDate(asOf)}
        </time>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-blue-500/50 to-transparent" />
      </p>
    </li>
  );
}

/** One numbered list of every source the timeline cites, each URL once. */
function SourcesList({ list }: { list: NumberedSources["list"] }) {
  if (list.length === 0) return null;
  return (
    <div className="mt-6 border-t border-line pt-4" data-testid="timeline-sources">
      <h4 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-fg-1">
        Sources <span className="font-normal text-fg-3">official text behind the dates above</span>
      </h4>
      <ol className="space-y-1">
        {list.map((s) => (
          <li key={s.url} id={`tl-src-${s.n}`} className="flex min-w-0 scroll-mt-4 items-baseline gap-2 rounded-sm transition-colors duration-300 target:bg-blue-900/60">
            <span className="num w-4 shrink-0 text-right text-[11px] text-fg-3">{s.n}</span>
            <SourceLink url={s.url} title={s.title} quote={s.quote} maxChars={56} className="min-w-0" />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Timeline({ ex, nextKey }: { ex: Explanation; nextKey: string | undefined }) {
  const nodes = buildNodes(ex);
  const sources = numberSources(nodes);
  const today = todayIndex(nodes, ex.asOf);
  const rows: ReactNode[] = [];
  nodes.forEach((n, i) => {
    if (today === i) rows.push(<TodayRow key="today" asOf={ex.asOf} last={false} />);
    rows.push(<NodeRow key={n.key} n={n} state={nodeState(n, nextKey, ex.asOf)} last={i === nodes.length - 1 && today !== nodes.length} i={i + (today !== null && today <= i ? 1 : 0)} refs={sources.refs.get(n.key) ?? []} />);
  });
  if (today === nodes.length) rows.push(<TodayRow key="today" asOf={ex.asOf} last />);
  return (
    <div data-testid="item-timeline">
      <ol aria-label="Dates for this item">{rows}</ol>
      <SourcesList list={sources.list} />
    </div>
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
  const isClosed = it.status === "resolved_paid" || it.status === "remitted";
  // The "Next deadline" chip and the footer both come from item.nextDeadline, so they always agree (F14).
  const nextKey = isClosed ? undefined : (it.nextDeadline?.kind ?? undefined);
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
        <Timeline ex={ex} nextKey={nextKey} />
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
