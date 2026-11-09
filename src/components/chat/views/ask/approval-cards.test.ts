import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalRequest, closeRequest, needsAcknowledgement } from "@/lib/ask/cards/approval-request";
import type { ApprovalsReviewUi, FilingCardUi, OutreachDraftsUi, PeriodCloseUi, ReviewRow } from "@/lib/ask/cards/approval-ui-types";
import type { UiPayload } from "@/lib/chat/ui-types";
import { followUpsFor } from "../../followups";
import { ViewRenderer } from "../registry";

const H = (c: string) => c.repeat(64);
const OUTREACH_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";

const letterRow: ReviewRow = {
  key: `o:${OUTREACH_ID}`,
  kind: "letter",
  title: "Mail due-diligence letter · Ravenhill Cabinetry",
  subtitle: "#10087 · Check · CA",
  amountCents: 219470,
  state: "CA",
  recipient: ["Ravenhill Cabinetry", "12 Main St", "Fresno, CA 93701"],
  payload: ["Check #10087", "Rule file ca-2026.1; notice wording comes from the rule file."],
  approveEffect: "Records your approval of exactly this content. Nothing is mailed, emailed or called.",
  irreversible: "Mailing it (Lob test mode only) is a separate Send step in Approvals.",
  unverified: true,
  blockers: [],
  bodyText: "Dear Ravenhill Cabinetry, our records show...",
  approve: { kind: "outreach", outreachId: OUTREACH_ID, contentSha256: H("a") },
  openHref: `/approvals?sel=o%3A${OUTREACH_ID}`,
};
const reportRow: ReviewRow = {
  ...letterRow,
  key: `r:${REPORT_ID}`,
  kind: "report",
  title: "Submit CA unclaimed property report",
  recipient: ["Replica CA unclaimed property portal"],
  bodyText: null,
  approve: { kind: "report", reportId: REPORT_ID, checksum: H("b"), unverified: 7, unsent: 2 },
  openHref: `/approvals?sel=r%3A${REPORT_ID}`,
};
const emailRow: ReviewRow = { ...letterRow, key: "o:e", kind: "email", approve: null, blockers: ["Pick the allowlisted test recipient in Approvals before approving."], bodyText: null };

const reviewUi: ApprovalsReviewUi = {
  kind: "approvals_review",
  props: {
    asOf: "2026-11-01",
    total: 4,
    groups: [
      { kind: "letter", label: "Mail letters", rows: [letterRow], more: 0 },
      { kind: "email", label: "Send emails", rows: [emailRow], more: 1 },
      { kind: "report", label: "Submit reports", rows: [reportRow], more: 0 },
    ],
  },
};
const draftsUi: OutreachDraftsUi = {
  kind: "outreach_drafts",
  props: {
    asOf: "2026-11-01",
    query: null,
    drafts: [],
    candidates: [
      { staleItemId: "s1", checkNumber: "10087", payeeName: "Ravenhill Cabinetry", state: "CA", amountCents: 219470, windowEnd: "2027-05-02", unverified: true, decision: "draft", reason: null, hasDraft: false },
      { staleItemId: "s2", checkNumber: "10482", payeeName: "Other Co", state: "CA", amountCents: 5000, windowEnd: null, unverified: false, decision: "skip", reason: "The due-diligence window opens Oct 31, 2028.", hasDraft: false },
    ],
    notFound: null,
  },
};
const tie = { state: "CA", openingCents: 100, closingCents: 200, reconciles: true, unverifiedRules: 30, hasRules: true };
const closeUi: PeriodCloseUi = {
  kind: "period_close",
  props: {
    asOf: "2026-11-01",
    period: "2026-10",
    label: "October 2026",
    status: "open",
    preview: { entryCount: 12, journalSha256: H("c"), closingCents: 2_841_000, notOver: false, coversThrough: "2026-10-31" },
    tieOut: { allTie: true, total: { ...tie, state: "Total", unverifiedRules: 0 }, states: [tie] },
    closed: null,
    otherOpen: [{ period: "2026-09", label: "September 2026" }],
  },
};
const filingUi = (status: string, approve = true): FilingCardUi => ({
  kind: "filing",
  props: {
    asOf: "2026-11-01",
    state: "CA",
    hasRules: true,
    ruleVersion: "ca-2026.1",
    unverifiedRules: 7,
    toReport: { count: 21, cents: 2_841_000 },
    report: {
      status,
      stage: "notice",
      itemCount: 21,
      totalCents: 2_841_000,
      errorCount: 0,
      warningCount: 1,
      confirmation: null,
      approve: approve ? { kind: "report", reportId: REPORT_ID, checksum: H("b"), unverified: 7, unsent: 2 } : null,
    },
    filingRun: null,
    runnerHref: "/close-out/CA",
    reportsHref: "/reports?state=CA",
  },
});

const render = (ui: UiPayload) => renderToStaticMarkup(createElement(ViewRenderer, { ui }));

afterEach(() => vi.restoreAllMocks());

describe("Ask approval cards", () => {
  it("mounting any approval card makes no request (every POST is a person's click)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network in tests")));
    for (const ui of [reviewUi, draftsUi, closeUi, filingUi("validated"), filingUi("approved")]) expect(render(ui).length).toBeGreaterThan(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("every Approve button starts disabled: no approver name typed yet", () => {
    for (const ui of [reviewUi, closeUi, filingUi("validated")]) {
      const buttons = render(ui).match(/<button[^>]*data-testid="(?:review-approve|period-close-approve|filing-approve)"[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(b).toMatch(/disabled=""/);
    }
  });

  it("the review card groups by action and shows what will happen, the recipient and UNVERIFIED", () => {
    const html = render(reviewUi);
    expect((html.match(/data-testid="review-group"/g) ?? []).length).toBe(3);
    expect(html).toContain("Fresno, CA 93701");
    expect(html).toContain("Lob test mode");
    expect(html).toContain("Read the letter exactly as it will print");
    expect(html).toContain("UNVERIFIED");
    expect(html).toContain("+1 more in Approvals.");
    // Email needs a recipient picked in Approvals: no inline Approve, an Open link instead.
    expect((html.match(/data-testid="review-approve"/g) ?? []).length).toBe(2);
    expect(html).toContain("Pick the allowlisted test recipient in Approvals");
    expect(html).toContain(`href="/approvals?sel=r%3A${REPORT_ID}"`);
    // A report must acknowledge UNVERIFIED values and never-sent notices before it can be approved.
    expect(html).toContain('data-testid="review-approve-ack"');
    expect(html).toContain("7 UNVERIFIED rule values");
  });

  it("the Approve click carries the server-provided hash verbatim, to the existing endpoint", () => {
    expect(approvalRequest(letterRow.approve!, " Dana ")).toEqual({ url: `/api/outreach/${OUTREACH_ID}/approve`, body: { approvedBy: "Dana", expectedContentSha256: H("a") } });
    expect(approvalRequest(reportRow.approve!, "Dana", false).body).toEqual({ approvedBy: "Dana", expectedChecksum: H("b"), acknowledgedUnverified: null, acknowledgedUnsent: null });
    expect(approvalRequest(reportRow.approve!, "Dana", true).body).toMatchObject({ acknowledgedUnverified: 7, acknowledgedUnsent: 2 });
    expect(approvalRequest({ kind: "claim", recoveryId: "r1", payloadSha256: H("d") }, "Dana")).toEqual({ url: "/api/recoveries/r1/approve", body: { approvedBy: "Dana", expectedPayloadSha256: H("d") } });
    expect(closeRequest("2026-10", "Dana", H("c"))).toEqual({ url: "/api/close-pack", body: { period: "2026-10", approvedBy: "Dana", expectedJournalSha256: H("c") } });
    expect(needsAcknowledgement(reportRow.approve!)).toBe(true);
    expect(needsAcknowledgement(letterRow.approve!)).toBe(false);
  });

  it("draft outreach offers Request approval only for items the shared eligibility check allows", () => {
    const html = render(draftsUi);
    expect((html.match(/data-testid="draft-request-approval"/g) ?? []).length).toBe(1);
    expect(html).toContain("The due-diligence window opens Oct 31, 2028.");
    expect(html).toContain("Send-by date UNKNOWN");
  });

  it("the close card shows the tie-out, the irreversibility and the coral close", () => {
    const html = render(closeUi);
    expect(html).toContain('data-testid="period-close-tieout"');
    expect(html).toContain("It cannot be undone.");
    expect(html).toContain("Approve close of October 2026");
    expect(html).toContain("UNVERIFIED");
    expect(html).toContain("Close September 2026");
    const closed = render({ ...closeUi, props: { ...closeUi.props, status: "closed", preview: null, closed: { manifestSha256: H("e"), chainSeq: 21, closedBy: "Dana", demoDate: "2026-11-01" } } });
    expect(closed).toContain('data-testid="period-close-download"');
    expect(closed).toContain('href="/api/close-pack?period=2026-10"');
    expect(closed).not.toContain('data-testid="period-close-approve"');
  });

  it("the filing card shows the approval step first, then routes to the replica runner; it never starts a filing", () => {
    const pending = render(filingUi("validated"));
    expect(pending).toContain('data-testid="filing-approve"');
    expect(pending).not.toContain('data-testid="filing-open-runner"');
    const approved = render(filingUi("approved"));
    expect(approved).not.toContain('data-testid="filing-approve"');
    expect(approved).toContain('href="/close-out/CA"');
    expect(approved).toContain("replica");
    const blocked = render({ ...filingUi("validated", false), props: { ...filingUi("validated", false).props, report: { ...filingUi("validated", false).props.report!, errorCount: 2 } } });
    expect(blocked).not.toContain('data-testid="filing-approve"');
    expect(blocked).toContain("2 validation errors");
    for (const html of [pending, approved]) expect(html).not.toMatch(/\/api\/agents\/file/);
  });

  it("follow-up chips after these cards never point at approving, sending, filing or closing", () => {
    for (const ui of [reviewUi, draftsUi, closeUi, filingUi("approved")]) {
      for (const q of followUpsFor([ui], [])) expect(q).not.toMatch(/\b(approve|send|file|submit|close (?!out))\b/i);
    }
  });
});
