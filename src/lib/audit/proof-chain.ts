/**
 * Audit Drill: the proof chain for one stale item. An auditor sampling a holder's file asks, for every item, "show me
 * the paper": the ledger row, that it never cleared, why it belongs to this state, which rule dated it, the
 * due-diligence letter, the owner's answer, the line in the filed NAUPA file, the portal's confirmation and the money.
 *
 * Pure: the facts are gathered read-only by src/lib/queries/audit.ts. Nothing here decides the law. Whether due
 * diligence applies comes from the rules engine (computeItemTimeline's ddApplies), every date is an engine date
 * persisted on the item, and a rule value no person has verified can never make a link "proven".
 */
import type { StaleStatus } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";

export const LINK_KINDS = ["ledger", "bank", "owner_state", "rule", "dd_letter", "owner_response", "naupa_line", "replica", "remittance"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_LABELS: Record<LinkKind, string> = {
  ledger: "Ledger record",
  bank: "Not cleared at the bank",
  owner_state: "Owner state + basis",
  rule: "Rule version + source",
  dd_letter: "Due-diligence letter",
  owner_response: "Owner response",
  naupa_line: "Line in the NAUPA file",
  replica: "Replica confirmation",
  remittance: "Remittance",
};

export const LINK_STATUSES = ["proven", "missing", "rules_gap", "not_yet_due", "not_required"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const STATUS_LABELS: Record<LinkStatus, string> = {
  proven: "Proven",
  missing: "Missing",
  rules_gap: "Rules gap",
  not_yet_due: "Not yet due",
  not_required: "Not required",
};

export interface LinkSource {
  title: string;
  url: string;
}

export interface ProofFix {
  href: string;
  label: string;
}

export interface ProofLink {
  kind: LinkKind;
  label: string;
  status: LinkStatus;
  /** One plain sentence: what the record shows, or what is absent. */
  evidence: string;
  /** Short supporting facts (dates, ids, checksums). */
  detail: string[];
  sources: LinkSource[];
  /** True when the link rests on a rule value no person has verified (shown as UNVERIFIED). */
  unverified: boolean;
  /** The existing gate where a person fixes a missing link. Only missing links and rules gaps carry one. */
  fix: ProofFix | null;
}

export type ReconStanding = "outstanding" | "voided" | "matched" | "ambiguous" | "absent";

export interface SentNotice {
  channel: "letter" | "email";
  status: string;
  /** Demo date it went out (sent_at mapped through demoDayAt), or null when unknown. */
  sentOn: string | null;
  outreachId: string;
}

export interface FiledLine {
  reportId: string;
  stage: string | null;
  checksum: string | null;
  confirmation: string | null;
  submittedOn: string | null;
}

export interface RemittanceFact {
  remittedOn: string;
  reference: string | null;
  by: string;
  approvalId: string | null;
  approvedOn: string | null;
}

/** Everything known about one item, gathered read-only. */
export interface ItemFacts {
  staleItemId: string;
  status: StaleStatus;
  amountCents: number;
  ownerState: string | null;
  ownerStateBasis: "address" | "incorporation" | null;
  ledger: { referenceNumber: string | null; issueDate: string; amountCents: number; source: string; status: string } | null;
  recon: { standing: ReconStanding; reason?: string };
  rule: { version: string | null; dependsOnUnverified: boolean; sources: LinkSource[] };
  /** From the rules engine (computeItemTimeline). null = the engine could not tell (a rule value is missing). */
  ddApplies: boolean | null;
  ddWindowStart: string | null;
  ddWindowEnd: string | null;
  notices: SentNotice[];
  ownerResponse: { intent: string; on: string | null } | null;
  reportDue: string | null;
  remitDue: string | null;
  filed: FiledLine | null;
  remittance: RemittanceFact | null;
}

const d = (iso: string | null | undefined): string => (iso ? formatDate(iso) : "unknown date");

function link(kind: LinkKind, status: LinkStatus, evidence: string, extra: Partial<Pick<ProofLink, "detail" | "sources" | "unverified" | "fix">> = {}): ProofLink {
  return {
    kind,
    label: LINK_LABELS[kind],
    status,
    evidence,
    detail: extra.detail ?? [],
    sources: extra.sources ?? [],
    unverified: extra.unverified ?? false,
    fix: status === "missing" || status === "rules_gap" ? (extra.fix ?? null) : null,
  };
}

const fixes = (f: ItemFacts) => {
  const st = f.ownerState ?? "";
  return {
    item: { href: `/items?item=${f.staleItemId}`, label: "Review the item" },
    rules: { href: st ? `/rules?state=${st}` : "/rules", label: st ? `Verify ${st} rules` : "Open rules" },
    letter: { href: st ? `/approvals?kind=letter&state=${st}` : "/approvals", label: "Approve the letter" },
    closeOut: { href: st ? `/close-out/${st}` : "/reports", label: st ? `Run ${st} close-out` : "Open reports" },
  } satisfies Record<string, ProofFix>;
};

function ledgerLink(f: ItemFacts): ProofLink {
  if (!f.ledger) return link("ledger", "missing", "No ledger row backs this item.", { fix: fixes(f).item });
  const l = f.ledger;
  return link("ledger", "proven", `${l.referenceNumber ? `Ref ${l.referenceNumber}` : "Unnumbered entry"} for ${formatUSD(l.amountCents)}, issued ${d(l.issueDate)}.`, {
    detail: [`Source: ${l.source}`, `Ledger status: ${l.status}`],
  });
}

function bankLink(f: ItemFacts): ProofLink {
  const fix = fixes(f).item;
  switch (f.recon.standing) {
    case "outstanding":
      return link("bank", "proven", "Reconciliation finds no bank clear for it as of the demo date.");
    case "voided":
      return link("bank", "proven", "Voided in the ledger and never cleared the bank.");
    case "matched":
      return link("bank", "missing", f.recon.reason ?? "A bank clear matches this entry, so it may not be owed to the state.", { fix });
    case "ambiguous":
      return link("bank", "missing", f.recon.reason ?? "Several bank clears could match this entry; a person has to decide.", { fix });
    default:
      return link("bank", "missing", f.recon.reason ?? "The ledger row is not in the reconciliation (reissued or removed).", { fix });
  }
}

function ownerStateLink(f: ItemFacts): ProofLink {
  if (!f.ownerState || !f.ownerStateBasis) {
    return link("owner_state", "missing", "The owner's state or the basis for it is not recorded.", { fix: fixes(f).item });
  }
  const basis = f.ownerStateBasis === "address" ? "the owner's last known address" : "the holder's state of incorporation (owner address unknown)";
  return link("owner_state", "proven", `${f.ownerState}, from ${basis}.`);
}

const rulesName = (f: ItemFacts): string => (f.ownerState ? `${f.ownerState} rules` : "Rules");

function ruleLink(f: ItemFacts): ProofLink {
  const sources = f.rule.sources;
  if (!f.rule.version) return link("rule", "missing", "No rule version is recorded for this item's dates.", { fix: fixes(f).rules, sources });
  if (f.rule.dependsOnUnverified) {
    // The rule file exists and dated this item; what is open is one state-wide action (verify the state's values). It is
    // a rules gap, not a missing proof, and readiness counts it once per state (see score.ts).
    return link("rule", "rules_gap", `Rule UNVERIFIED: ${rulesName(f)} ${f.rule.version} include values no person has checked against the source. The rule version is on file; this is one state-wide action, not a missing record.`, {
      sources,
      unverified: true,
      fix: fixes(f).rules,
    });
  }
  return link("rule", "proven", `Dated by ${rulesName(f)} ${f.rule.version}, every value verified.`, { sources });
}

const firstSent = (f: ItemFacts): SentNotice | null =>
  [...f.notices].sort((a, b) => (a.sentOn ?? "9999").localeCompare(b.sentOn ?? "9999"))[0] ?? null;

function ddLink(f: ItemFacts, today: string): ProofLink {
  const fx = fixes(f);
  const unverified = f.rule.dependsOnUnverified;
  if (f.ddApplies === false) {
    return link("dd_letter", "not_required", "The rules engine says no due-diligence notice is required for this item.", { unverified });
  }
  if (f.ddApplies === null) {
    return link("dd_letter", "missing", "The rules engine cannot tell whether a notice is required: a rule value is missing.", { fix: fx.rules });
  }
  const start = f.ddWindowStart;
  const end = f.ddWindowEnd;
  const window = start && end ? `${d(start)} to ${d(end)}` : null;
  const sent = firstSent(f);
  if (sent) {
    const detail = [`${sent.channel === "letter" ? "Letter" : "Email"} ${sent.status}`, ...(window ? [`Window ${window}`] : [])];
    if (!start || !end || !sent.sentOn) {
      return link("dd_letter", "missing", "A notice went out, but the window or the send date is unknown, so timing cannot be shown.", { detail, unverified, fix: fx.rules });
    }
    if (sent.sentOn >= start && sent.sentOn <= end) {
      return link("dd_letter", "proven", `Sent ${d(sent.sentOn)}, inside the window.`, { detail, unverified });
    }
    return link("dd_letter", "missing", `Sent ${d(sent.sentOn)}, outside the window (${window}).`, { detail, unverified, fix: fx.letter });
  }
  if (!start || !end) {
    return link("dd_letter", "missing", "The due-diligence window is unknown: a rule value is missing.", { unverified, fix: fx.rules });
  }
  if (today < start) {
    return link("dd_letter", "not_yet_due", `Window opens ${d(start)}.`, { detail: [`Window ${window}`], unverified });
  }
  if (today <= end) {
    return link("dd_letter", "missing", `Window is open (closes ${d(end)}) and no letter has been sent.`, { detail: [`Window ${window}`], unverified, fix: fx.letter });
  }
  return link("dd_letter", "missing", `Window closed ${d(end)} and no letter was sent.`, { detail: [`Window ${window}`], unverified, fix: fx.letter });
}

function responseLink(f: ItemFacts, dd: ProofLink, today: string): ProofLink {
  if (dd.status === "not_required") return link("owner_response", "not_required", "No notice was required, so no reply is expected.");
  if (f.ownerResponse) {
    return link("owner_response", "proven", `Owner replied${f.ownerResponse.on ? ` ${d(f.ownerResponse.on)}` : ""} (${f.ownerResponse.intent.replace(/_/g, " ")}).`);
  }
  const sent = firstSent(f);
  if (sent) {
    if (!f.ddWindowEnd || today <= f.ddWindowEnd) {
      return link("owner_response", "not_yet_due", f.ddWindowEnd ? `Awaiting a reply; the window closes ${d(f.ddWindowEnd)}.` : "Awaiting a reply.");
    }
    return link("owner_response", "proven", `No reply by the window close (${d(f.ddWindowEnd)}); the record shows the notice went unanswered.`);
  }
  // The letter is not out yet (window not open, or open with time left): the reply cannot be due before it.
  if (dd.status === "not_yet_due" || (f.ddWindowEnd !== null && today <= f.ddWindowEnd)) {
    return link("owner_response", "not_yet_due", "Waits on the due-diligence letter.");
  }
  return link("owner_response", "missing", "No letter went out, so no reply could be recorded.", { fix: fixes(f).letter });
}

const isFiledStatus = (s: StaleStatus) => s === "reported" || s === "remitted";

/** When the item has not been filed: not yet due, overdue (missing) or unknown (missing). */
function unfiled(kind: LinkKind, f: ItemFacts, today: string, what: string): ProofLink {
  const fx = fixes(f);
  if (!f.reportDue) return link(kind, "missing", `The report due date is unknown: a rule value is missing.`, { fix: fx.rules });
  if (f.reportDue < today) return link(kind, "missing", `The report was due ${d(f.reportDue)}; ${what}.`, { unverified: f.rule.dependsOnUnverified, fix: fx.closeOut });
  return link(kind, "not_yet_due", `Report due ${d(f.reportDue)}.`, { unverified: f.rule.dependsOnUnverified });
}

function naupaLink(f: ItemFacts, today: string): ProofLink {
  if (f.status === "resolved_paid") return link("naupa_line", "not_required", "The owner was paid; nothing to report.");
  if (f.filed) {
    return link("naupa_line", "proven", `Listed in the filed ${f.ownerState ? `${f.ownerState} ` : ""}report file.`, {
      detail: [`Report ${f.filed.reportId.slice(0, 8)}`, ...(f.filed.stage ? [`Stage: ${f.filed.stage}`] : []), ...(f.filed.checksum ? [`SHA-256 ${f.filed.checksum.slice(0, 12)}`] : [])],
    });
  }
  if (isFiledStatus(f.status)) {
    return link("naupa_line", "missing", "Marked reported, but no filed report file lists it.", { fix: fixes(f).closeOut });
  }
  return unfiled("naupa_line", f, today, "no filed file lists it");
}

function replicaLink(f: ItemFacts, today: string): ProofLink {
  if (f.status === "resolved_paid") return link("replica", "not_required", "The owner was paid; nothing was filed.");
  if (f.filed) {
    if (f.filed.confirmation) {
      return link("replica", "proven", `Replica portal confirmed ${f.filed.confirmation}.`, { detail: f.filed.submittedOn ? [`Submitted ${d(f.filed.submittedOn)}`] : [] });
    }
    return link("replica", "missing", "The report was filed but the portal confirmation is not recorded.", { fix: fixes(f).closeOut });
  }
  if (isFiledStatus(f.status)) return link("replica", "missing", "No filed report with a confirmation lists it.", { fix: fixes(f).closeOut });
  return unfiled("replica", f, today, "nothing was submitted");
}

function remittanceLink(f: ItemFacts, today: string): ProofLink {
  const fx = fixes(f);
  if (f.status === "resolved_paid") return link("remittance", "not_required", "The owner was paid; nothing to remit.");
  if (f.remittance) {
    const r = f.remittance;
    return link("remittance", "proven", `Remitted ${d(r.remittedOn)}${r.reference ? `, reference ${r.reference}` : ""}.`, {
      detail: [`Recorded by ${r.by}`, ...(r.approvedOn ? [`Approved ${d(r.approvedOn)}`] : []), ...(r.approvalId ? [`Approval ${r.approvalId.slice(0, 8)}`] : [])],
    });
  }
  if (f.status === "remitted") return link("remittance", "missing", "Marked remitted, but no remittance record is attached.", { fix: fx.closeOut });
  if (!f.remitDue) return link("remittance", "missing", "The remit due date is unknown: a rule value is missing.", { fix: fx.rules });
  const unverified = f.rule.dependsOnUnverified;
  if (f.remitDue < today) return link("remittance", "missing", `Remittance was due ${d(f.remitDue)} and is not recorded.`, { unverified, fix: fx.closeOut });
  return link("remittance", "not_yet_due", `Remittance due ${d(f.remitDue)}.`, { unverified });
}

/** The nine links for one item, in chain order. `today` is the demo-clock date. */
export function buildProofChain(f: ItemFacts, today: string): ProofLink[] {
  const dd = ddLink(f, today);
  return [ledgerLink(f), bankLink(f), ownerStateLink(f), ruleLink(f), dd, responseLink(f, dd, today), naupaLink(f, today), replicaLink(f, today), remittanceLink(f, today)];
}
