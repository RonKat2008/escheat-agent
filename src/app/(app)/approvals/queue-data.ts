import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  approvals,
  ledgerItems,
  outreach,
  payees,
  recoveries,
  reports,
  ruleChanges,
  staleItems,
} from "@/db/schema";
import { allowedPhones, allowedRecipients, hasLob } from "@/lib/env";
import { formatAddress } from "@/lib/queries";
import { outreachContentSha256 } from "@/lib/outreach/util";
import { claimPayloadSha256 } from "@/lib/recoveries/service";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";

export type QueueKind = "letter" | "email" | "voice" | "report" | "claim" | "rule";

export interface Readiness {
  ready: boolean;
  problems: string[];
  warnings: string[];
}

export interface OutreachView {
  id: string;
  channel: "letter" | "email" | "voice";
  status: string;
  subject: string | null;
  /** Email/voice only; letters render through the preview iframe. */
  body: string | null;
  toAddress: string | null;
  /** False until a letter/email/script body has been composed for this draft. */
  composed: boolean;
  readiness: Readiness;
  /** Hash of the draft as shown here; sent back on approve so changed content is rejected (M2). */
  contentSha256: string;
  requiredLanguageVerified: boolean | null;
  offline: boolean;
  simulated: boolean;
  providerId: string | null;
  previewUrl: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  staleItemId: string;
  ownerName: string;
  ownerAddress: string;
  referenceNumber: string | null;
  propertyLabel: string;
  ruleVersion: string | null;
  dependsOnUnverified: boolean;
  /** Same item, other channels (any status). */
  siblings: Partial<Record<"letter" | "email" | "voice", { id: string; status: string }>>;
}

export interface ReportView {
  id: string;
  state: string;
  stage: string | null;
  status: string;
  itemCount: number;
  totalCents: number;
  errorCount: number;
  warningCount: number;
  checksum: string | null;
}

export interface ClaimView {
  id: string;
  state: string;
  amountCents: number;
  matchedNameVariant: string | null;
  status: string;
  matchConfidence: number | null;
  /** Hash of the claim payload as shown here; sent back on approve (M2). */
  payloadSha256: string;
}

export interface RuleView {
  id: string;
  state: string;
  fromVersion: string | null;
  toVersion: string | null;
  sourceCount: number;
}

export interface QueueEntry {
  key: string;
  kind: QueueKind;
  title: string;
  subtitle: string;
  amountCents: number | null;
  state: string | null;
  dueDate: string | null;
  statusKey: string;
  actionable: boolean;
  outreach?: OutreachView;
  report?: ReportView;
  claim?: ClaimView;
  rule?: RuleView;
}

export interface QueueData {
  entries: QueueEntry[];
  env: { lobConfigured: boolean; allowedEmails: string[]; allowedPhones: string[] };
}

const ACTIONABLE = new Set(["draft", "awaiting_approval", "approved", "failed"]);

function readinessOf(tracking: Record<string, unknown> | null): { readiness: Readiness; verified: boolean | null } {
  const compose = (tracking?.compose ?? {}) as { readiness?: Partial<Readiness>; requiredLanguageVerified?: boolean };
  const r = compose.readiness ?? {};
  return {
    readiness: { ready: r.ready !== false, problems: r.problems ?? [], warnings: r.warnings ?? [] },
    verified: typeof compose.requiredLanguageVerified === "boolean" ? compose.requiredLanguageVerified : null,
  };
}

const CHANNEL_TITLE = { letter: "Mail due-diligence letter", email: "Send due-diligence email", voice: "Place check-in call" } as const;

export async function loadQueue(db: Db, companyId: string): Promise<QueueData> {
  const rows = await db
    .select({ o: outreach, s: staleItems, l: ledgerItems })
    .from(outreach)
    .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(outreach.companyId, companyId))
    .orderBy(desc(outreach.createdAt));

  const payeeIds = [...new Set(rows.map((r) => r.s.ownerPayeeId ?? r.l.payeeId).filter((x): x is string => !!x))];
  const payeeRows = payeeIds.length ? await db.select().from(payees).where(inArray(payees.id, payeeIds)) : [];
  const approvalIds = rows.map((r) => r.o.approvalId).filter((x): x is string => !!x);
  const approvalRows = approvalIds.length ? await db.select().from(approvals).where(inArray(approvals.id, approvalIds)) : [];

  const byItem = new Map<string, OutreachView["siblings"]>();
  for (const { o } of rows) {
    const prev = byItem.get(o.staleItemId) ?? {};
    if (!prev[o.channel]) prev[o.channel] = { id: o.id, status: o.status };
    byItem.set(o.staleItemId, prev);
  }

  const entries: QueueEntry[] = [];
  for (const { o, s, l } of rows) {
    const payee = payeeRows.find((p) => p.id === (s.ownerPayeeId ?? l.payeeId));
    const ap = approvalRows.find((a) => a.id === o.approvalId);
    const { readiness, verified } = readinessOf(o.tracking);
    const ownerName = payee?.canonicalName ?? l.payeeNameRaw;
    const view: OutreachView = {
      id: o.id,
      channel: o.channel,
      status: o.status,
      subject: o.subject,
      body: o.channel === "letter" ? null : o.channel === "voice" ? o.body : o.body ? stripHtml(o.body) : null,
      toAddress: o.toAddress,
      composed: o.body !== null && o.body.trim() !== "",
      readiness,
      contentSha256: outreachContentSha256(o),
      requiredLanguageVerified: verified,
      offline: o.offline,
      simulated: o.tracking?.simulated === true,
      providerId: o.providerId,
      previewUrl: o.previewUrl,
      approvedBy: ap?.approvedBy ?? null,
      approvedAt: ap?.approvedAt?.toISOString() ?? null,
      sentAt: o.sentAt?.toISOString() ?? null,
      staleItemId: o.staleItemId,
      ownerName,
      ownerAddress: formatAddress({
        addressLine: payee?.addressLine ?? l.addressLine,
        city: payee?.city ?? l.city,
        state: payee?.state ?? l.state,
        zip: payee?.zip ?? l.zip,
      }),
      referenceNumber: l.referenceNumber,
      propertyLabel: PROPERTY_TYPE_LABEL[s.propertyType] ?? s.propertyType,
      ruleVersion: s.ruleVersion,
      dependsOnUnverified: s.dependsOnUnverified,
      siblings: byItem.get(o.staleItemId) ?? {},
    };
    entries.push({
      key: `o:${o.id}`,
      kind: o.channel,
      title: `${CHANNEL_TITLE[o.channel]} · ${ownerName}`,
      subtitle: [l.referenceNumber ? `#${l.referenceNumber}` : null, view.propertyLabel, s.ownerState].filter(Boolean).join(" · "),
      amountCents: s.amountCents,
      state: s.ownerState,
      dueDate: s.ddWindowEnd ?? s.reportDueDate,
      statusKey: o.status,
      actionable: ACTIONABLE.has(o.status),
      outreach: view,
    });
  }

  const reportRows = await db
    .select()
    .from(reports)
    .where(eq(reports.companyId, companyId))
    .orderBy(desc(reports.createdAt));
  for (const r of reportRows.filter((x) => ["validated", "awaiting_approval", "approved"].includes(x.status))) {
    const errs = (r.validationErrors ?? []) as { severity?: string }[];
    entries.push({
      key: `r:${r.id}`,
      kind: "report",
      title: `Submit ${r.state} unclaimed property report`,
      subtitle: `${r.itemCount} items · NAUPA file · ${r.stage ?? "annual"} stage`,
      amountCents: r.totalCents,
      state: r.state,
      dueDate: null,
      statusKey: r.status === "approved" ? "approved" : "awaiting_approval",
      actionable: r.status !== "approved",
      report: {
        id: r.id,
        state: r.state,
        stage: r.stage,
        status: r.status,
        itemCount: r.itemCount,
        totalCents: r.totalCents,
        errorCount: errs.filter((e) => e.severity === "error").length,
        warningCount: errs.filter((e) => e.severity === "warning").length,
        checksum: r.checksum,
      },
    });
  }

  const recRows = await db.select().from(recoveries).where(eq(recoveries.companyId, companyId));
  for (const r of recRows.filter((x) => ["found", "claim_drafted", "awaiting_approval"].includes(x.status))) {
    entries.push({
      key: `c:${r.id}`,
      kind: "claim",
      title: `File ${r.state} claim for money owed to you`,
      subtitle: `Matched “${r.matchedNameVariant ?? r.holderNameFound ?? "name variant"}” on the replica ${r.state} portal`,
      amountCents: r.amountCents,
      state: r.state,
      dueDate: null,
      statusKey: r.approvalId ? "approved" : "awaiting_approval",
      actionable: !r.approvalId,
      claim: {
        id: r.id,
        state: r.state,
        amountCents: r.amountCents,
        matchedNameVariant: r.matchedNameVariant,
        status: r.status,
        matchConfidence: r.matchConfidence,
        payloadSha256: await claimPayloadSha256(db, r),
      },
    });
  }

  const ruleRows = await db.select().from(ruleChanges).where(eq(ruleChanges.status, "proposed"));
  for (const r of ruleRows) {
    entries.push({
      key: `x:${r.id}`,
      kind: "rule",
      title: `Review ${r.state} rule change`,
      subtitle: `${r.fromVersion ?? "none"} to ${r.toVersion ?? "new version"} · ${r.sourceUrls.length} sources`,
      amountCents: null,
      state: r.state,
      dueDate: null,
      statusKey: "awaiting_approval",
      actionable: true,
      rule: { id: r.id, state: r.state, fromVersion: r.fromVersion, toVersion: r.toVersion, sourceCount: r.sourceUrls.length },
    });
  }

  entries.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    const ad = a.dueDate ?? "9999";
    const bd = b.dueDate ?? "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.amountCents ?? 0) - (a.amountCents ?? 0);
  });

  const done = entries.filter((e) => !e.actionable);
  const todo = entries.filter((e) => e.actionable);
  return {
    entries: [...todo, ...done.slice(0, 8)],
    env: { lobConfigured: hasLob(), allowedEmails: allowedRecipients(), allowedPhones: allowedPhones() },
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
