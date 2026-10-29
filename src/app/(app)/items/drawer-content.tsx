import { AlertTriangle, Info } from "lucide-react";
import {
  DateCell,
  EmptyState,
  Money,
  SourceLink,
  StatusPill,
  UnknownBadge,
  UnverifiedBadge,
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

function NodeRow({ n, state, last }: { n: Node; state: "past" | "next" | "future" | "unknown"; last: boolean }) {
  const sources = n.sources.slice(0, 3);
  return (
    <li className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-node={n.key}>
      {!last ? <span aria-hidden className="absolute top-4 bottom-0 left-[9px] w-px bg-border" /> : null}
      <span className="relative mt-1 grid size-5 place-items-center">
        <span
          aria-hidden
          className={cn(
            "size-3 rounded-full border-2",
            state === "past" && "border-slate bg-slate",
            state === "next" && "border-at-risk bg-at-risk/25 shadow-[0_0_0_4px_rgba(245,165,36,0.14)]",
            state === "future" && "border-subtle bg-surface",
            state === "unknown" && "border-dashed border-danger/70 bg-surface",
          )}
        />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn("text-sm font-medium", state === "next" && "text-at-risk")}>{n.label}</span>
          {n.date ? <DateCell date={n.date} /> : n.legal ? <UnknownBadge /> : null}
          {n.date && n.legal && !n.verified ? <UnverifiedBadge /> : null}
        </div>
        {n.note ? <p className="text-xs text-muted-foreground">{n.note}</p> : null}
        {n.legal && n.ruleVersion ? (
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={n.rulePaths.join(", ")}>
            rule {n.ruleVersion}
            {n.rulePaths[0] ? ` · ${n.rulePaths[0]}` : ""}
            {n.rulePaths.length > 1 ? ` +${n.rulePaths.length - 1}` : ""}
          </p>
        ) : null}
        {n.legal && n.status === "unknown" && n.notes[0] ? <p className="mt-1 text-xs text-danger">{n.notes[0]}</p> : null}
        {sources.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <SourceLink key={`${s.url}${s.quote}`} {...s} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

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
    <section aria-labelledby="res-h" className="rounded-xl border border-border bg-background/40 p-4" data-testid="resolution-section">
      <h3 id="res-h" className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Owner response and resolution</h3>
      {resp ? (
        <div className="mb-3 space-y-1 text-sm" data-testid="holder-task">
          <p>
            Owner replied via the response link{resp.at ? <span className="text-muted-foreground"> on {resp.at.slice(0, 10)}</span> : null}: <span className="font-medium">{resp.intent?.replace(/_/g, " ")}</span>.
          </p>
          {resp.holderTask ? <p className="text-muted-foreground">Holder task: {HOLDER_TASK_COPY[resp.holderTask] ?? resp.holderTask}</p> : null}
        </div>
      ) : null}
      {it.status === "resolved_paid" ? (
        <p className="text-sm" data-testid="resolved-note">
          Resolved (paid){cls.resolution?.by ? <> by {cls.resolution.by}</> : null}{cls.resolution?.at ? <span className="text-muted-foreground"> on {cls.resolution.at.slice(0, 10)}</span> : null}.
        </p>
      ) : terminal ? null : (
        <MarkResolved staleItemId={it.id} status={it.status as Parameters<typeof MarkResolved>[0]["status"]} />
      )}
    </section>
  );
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
    <div className="space-y-6 p-5 pb-8">
      <header className="space-y-2 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg leading-6 font-semibold">
            {it.checkNumber ? <span className="font-mono">#{it.checkNumber} · </span> : null}
            {it.payeeName}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusPill status={it.status} />
          <Money cents={it.amount.cents} className="text-lg font-semibold" />
          <span className="text-sm text-muted-foreground">
            {PROPERTY_TYPE_LABEL[it.propertyType]} · issued {formatSpan(it.ageDays)} ago
          </span>
        </div>
        {it.dependsOnUnverified && !isClosed ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <UnverifiedBadge /> Dates below depend on rule values nobody has verified yet.
          </p>
        ) : null}
      </header>

      <ResolutionSection ex={ex} />

      <section aria-labelledby="owner-h" className="rounded-xl border border-border bg-background/40 p-4">
        <h3 id="owner-h" className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Owner and state</h3>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold">{it.ownerState ?? "Unknown"}</span>
          <span className="text-sm text-muted-foreground">
            by {it.ownerStateBasis === "incorporation" ? "state of incorporation" : it.ownerStateBasis === "address" ? "owner address" : "unknown basis"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{it.ownerStateBasis ? BASIS_COPY[it.ownerStateBasis] : "The owner state could not be determined, so no state rules apply yet."}</p>
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Payee</dt>
          <dd>{ex.payee?.canonicalName ?? it.payeeName}{ex.payee && ex.payee.aliases.length > 0 ? <span className="text-muted-foreground"> · also {ex.payee.aliases.slice(0, 2).join(", ")}</span> : null}</dd>
          <dt className="text-muted-foreground">Address</dt>
          <dd>{ex.payee?.address || ex.ledger.address || <span className="text-muted-foreground italic">None on file</span>}</dd>
          {ex.ledger.memo ? (<><dt className="text-muted-foreground">Memo</dt><dd>{ex.ledger.memo}</dd></>) : null}
        </dl>
      </section>

      <section aria-labelledby="tl-h">
        <h3 id="tl-h" className="mb-3 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{isClosed ? "Timeline (history only)" : "Timeline"}</h3>
        <ol data-testid="item-timeline">
          {nodes.map((n, i) => {
            const state = !n.date ? "unknown" : n.key === nextKey ? "next" : n.date < ex.asOf ? "past" : "future";
            return <NodeRow key={n.key} n={n} state={state} last={i === nodes.length - 1} />;
          })}
        </ol>
        {isClosed ? (
          <p className="mt-3 text-xs text-muted-foreground">This item is closed, so no legal dates are pending. Dates above are shown for the record.</p>
        ) : it.nextDeadline ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Next legal date: {DEADLINE_LABEL[it.nextDeadline.kind]}, <span className="font-mono">{formatDate(it.nextDeadline.date)}</span>.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="cls-h" className="rounded-xl border border-border bg-background/40 p-4">
        <h3 id="cls-h" className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Classification</h3>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] tracking-[0.08em] uppercase", isHeuristic ? "border-at-risk/50 text-at-risk" : "border-sky/40 text-sky")}>
            {isHeuristic ? "Heuristic" : method}
          </span>
          <span className="text-muted-foreground">{PROPERTY_TYPE_LABEL[it.propertyType]}</span>
          {confidence !== null ? <span className="font-mono text-xs text-muted-foreground">{Math.round(confidence * 100)}% confidence</span> : <span className="text-xs text-muted-foreground">no model confidence</span>}
          {it.needsReview ? <span className="inline-flex items-center gap-1 text-xs text-at-risk"><AlertTriangle className="size-3" aria-hidden />Needs review</span> : null}
        </div>
        {rationale ? <p className="text-sm text-muted-foreground">{rationale}</p> : null}
      </section>

      {ex.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-border p-3 text-xs text-muted-foreground">
          {ex.warnings.slice(0, 4).map((w) => (
            <li key={w} className="flex gap-2"><Info className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="out-h">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id="out-h" className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Outreach</h3>
          <DraftOutreach staleItemId={it.id} />
        </div>
        {ex.outreach.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outreach yet. Drafting a letter queues it for your approval; nothing is sent automatically.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {ex.outreach.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-14 capitalize">{o.channel}</span>
                <StatusPill status={o.status} />
                <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{formatDate((o.sentAt ?? o.createdAt).slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
