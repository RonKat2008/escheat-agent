import { existsSync, readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb, migrate, type Db } from "@/db/client";
import { reports, staleItems } from "@/db/schema";
import { assertApproved, withApproval, type ApprovalRef } from "@/lib/approvals";
import { sha256Hex } from "@/lib/crypto";
import { ApprovalTimeoutError, waitForApproval, type WaitForApprovalOptions } from "./approval-wait";
import { appBaseUrl, guardedGoto, launchFencedBrowser, type FencedBrowser } from "./browser";
import { scriptedDriver, stagehandDriver, type PortalDriver, type PortalSummary } from "./driver";
import { finishBrowser } from "./finish";
import { RunRecorder, SCRIPTED_LABEL, type DriveMode } from "./recorder";
import { chooseMode, createRun, FILING_AGENT, releaseRun } from "./runs";
import { assertReplicaUrl } from "@/lib/replica/guard";
import { DEMO_PASSWORD, DEMO_USERNAME } from "./credentials";

export interface FilingOptions {
  reportId: string;
  /** Two-letter code; must equal the report's state. */
  state: string;
  baseUrl?: string;
  /** Test/e2e overrides for the approval wait loop. */
  wait?: Partial<Pick<WaitForApprovalOptions, "intervalMs" | "timeoutMs" | "sleep" | "now">>;
}

export class FilingPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilingPreconditionError";
  }
}

const FILEABLE = new Set(["validated", "awaiting_approval", "approved"]);

export const PAUSED_MESSAGE = "Paused at 'Approve submission' — waiting for human approval in Escheat Agent";

export type TotalsCheck = { ok: true } | { ok: false; error: string };

/** Pure: does the portal's summary agree with our own report row? */
export function compareTotals(report: { itemCount: number; totalCents: number }, portal: PortalSummary): TotalsCheck {
  const problems: string[] = [];
  if (report.itemCount !== portal.itemCount) problems.push(`item count: our report ${report.itemCount}, portal ${portal.itemCount}`);
  if (report.totalCents !== portal.totalCents) problems.push(`total: our report ${report.totalCents} cents, portal ${portal.totalCents} cents`);
  return problems.length === 0 ? { ok: true } : { ok: false, error: `Portal summary does not match our report (${problems.join("; ")}). Nothing was submitted.` };
}

export function submitApprovalRef(reportId: string, checksum: string): ApprovalRef {
  return { action: "submit_report", subjectId: reportId, payload: checksum };
}

async function startFiling(opts: FilingOptions): Promise<{ runId: string; done: Promise<void> }> {
  await migrate();
  const db = await getDb();
  const report = await loadFileableReport(db, opts);
  const mode = chooseMode();
  const runId = await createRun(db, {
    agent: FILING_AGENT,
    key: `filing:${report.id}`,
    subjectField: "reportId",
    subjectId: report.id,
    companyId: report.companyId,
    mode,
    modelLabel: mode === "stagehand" ? "stagehand" : "scripted",
    input: { state: opts.state.toUpperCase() },
  });
  return { runId, done: executeFiling(db, runId, opts, mode) };
}

/** Creates the run row and starts the agent in the background. Returns immediately with the run id. */
export async function launchFilingAgent(opts: FilingOptions): Promise<{ runId: string }> {
  const { runId, done } = await startFiling(opts);
  done.catch((err) => console.error("[filing-agent] unhandled:", err));
  return { runId };
}

/** Starts the agent and waits for it to finish (for scripts/tests running in-process). */
export async function runFilingAgent(opts: FilingOptions): Promise<{ runId: string }> {
  const { runId, done } = await startFiling(opts);
  await done;
  return { runId };
}

async function loadFileableReport(db: Db, opts: FilingOptions) {
  const [report] = await db.select().from(reports).where(eq(reports.id, opts.reportId));
  if (!report) throw new FilingPreconditionError(`Report ${opts.reportId} not found.`);
  if (report.state.toUpperCase() !== opts.state.toUpperCase()) {
    throw new FilingPreconditionError(`Report ${report.id} is for ${report.state}, not ${opts.state}.`);
  }
  if (!FILEABLE.has(report.status)) {
    throw new FilingPreconditionError(`Report is ${report.status}; only validated/approved reports can be filed.`);
  }
  if (!report.checksum || !report.filePath) throw new FilingPreconditionError("Report has no generated file/checksum yet.");
  if (!existsSync(report.filePath)) throw new FilingPreconditionError(`Report file is missing on disk: ${report.filePath}`);
  const text = readFileSync(report.filePath);
  // The report service hashes the string it writes as latin1, so hash the same decoding.
  if (sha256Hex(text.toString("latin1")) !== report.checksum) {
    throw new FilingPreconditionError("Report file on disk does not match its recorded checksum; regenerate the report.");
  }
  return report;
}

async function executeFiling(db: Db, runId: string, opts: FilingOptions, mode: DriveMode): Promise<void> {
  const baseUrl = opts.baseUrl ?? appBaseUrl();
  const rec = new RunRecorder(db, runId);
  const key = `filing:${opts.reportId}`;
  const st = opts.state.toLowerCase();
  let browser: FencedBrowser | undefined;
  let driver: PortalDriver | undefined;
  let restoreStatus: "validated" | "awaiting_approval" | "approved" | undefined;
  try {
    const report = await loadFileableReport(db, opts);
    restoreStatus = report.status as typeof restoreStatus;
    const checksum = report.checksum!;
    rec.setOutput({ mode, reportId: report.id, state: opts.state.toUpperCase(), artifactsDir: rec.dir });
    await rec.step("info", mode === "scripted" ? SCRIPTED_LABEL : `Drive mode: Stagehand (${process.env.STAGEHAND_MODEL ?? "default model"})`, { data: { mode } });

    browser = await launchFencedBrowser({ baseUrl, videoDir: rec.dir, rec });
    const { page } = browser;
    driver = mode === "stagehand"
      ? await stagehandDriver({ page, cdpUrl: browser.cdpUrl, apiKey: process.env.ANTHROPIC_API_KEY!, rec })
      : scriptedDriver(page);
    await rec.step("info", `Fenced browser launched (replica-only network fence on ${new URL(baseUrl).origin}), video recording on`);

    await guardedGoto(page, `${baseUrl}/replica/${st}-holder`, baseUrl, rec);
    await page.getByTestId("login-username").fill(DEMO_USERNAME);
    await page.getByTestId("login-password").fill(DEMO_PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/replica\/[a-z]{2}-holder\/dashboard/);
    assertReplicaUrl(page.url(), baseUrl);
    await rec.step("action", `Signed in to the ${opts.state.toUpperCase()} replica holder portal`, { page, shotName: "dashboard" });

    await page.getByTestId("file-report-link").click();
    await page.waitForURL(/\/upload/);
    assertReplicaUrl(page.url(), baseUrl);
    await page.getByTestId("naupa-upload").setInputFiles({
      name: report.filePath!.split("/").pop() ?? "report.txt",
      mimeType: "text/plain",
      buffer: readFileSync(report.filePath!),
    });
    await rec.step("action", `Selected NAUPA file (checksum ${checksum.slice(0, 12)}...)`, { page, shotName: "upload" });
    await page.getByTestId("upload-submit").click();
    await page.waitForURL(/\/review\//);
    assertReplicaUrl(page.url(), baseUrl);

    const summary = await driver.readSummary();
    await rec.step("extract", `Portal summary: ${summary.itemCount} items, $${(summary.totalCents / 100).toFixed(2)}, ${summary.byCode.length} property codes`, { page, shotName: "portal-summary", data: { summary } });

    const check = compareTotals(report, summary);
    const portalProblems = await page.getByTestId("summary-problems").count();
    const canApprove = (await page.getByTestId("approve-submission").count()) > 0;
    if (!check.ok) {
      await db
        .update(reports)
        .set({ status: "failed", validationErrors: [...(report.validationErrors ?? []), { source: "filing_agent", error: check.error }] })
        .where(eq(reports.id, report.id));
      restoreStatus = undefined;
      throw new Error(check.error);
    }
    if (!canApprove || portalProblems > 0) {
      const msg = `The portal reported problems with the uploaded file${canApprove ? "" : " and offers no Approve submission button"}. Nothing was submitted.`;
      await db.update(reports).set({ status: "failed", validationErrors: [...(report.validationErrors ?? []), { source: "filing_agent", error: msg }] }).where(eq(reports.id, report.id));
      restoreStatus = undefined;
      throw new Error(msg);
    }
    await rec.step("info", "Portal summary matches our report (item count and total).");

    if (report.status !== "approved") await db.update(reports).set({ status: "awaiting_approval" }).where(eq(reports.id, report.id));
    rec.setOutput({ phase: "awaiting_approval" });
    await rec.step("paused", PAUSED_MESSAGE, { page, shotName: "paused-awaiting-approval" });

    const ref = submitApprovalRef(report.id, checksum);
    await waitForApproval({
      ...opts.wait,
      check: () => assertApproved(db, ref),
      onWaiting: ({ attempt, reason }) => {
        if (attempt === 1 || reason === "payload_changed") {
          void rec.step("approval", reason === "payload_changed" ? "An approval exists but is for a different file checksum; still waiting." : "Waiting for human approval...");
        }
      },
    });
    rec.setOutput({ phase: "approved" });
    await rec.step("approval", "Human approval found for this exact file checksum; submitting.");

    const submitted = await withApproval(db, ref, async (approval) => {
      // Past the click the action is irreversible: failures after it must NOT release the approval.
      await driver!.clickApprove();
      let confirmation: string | null = null;
      let postError: string | undefined;
      try {
        await page.getByTestId("confirmation-number").waitFor({ timeout: 15_000 });
        confirmation = (await page.getByTestId("confirmation-number").innerText()).trim();
      } catch (err) {
        postError = err instanceof Error ? err.message : String(err);
      }
      return { approvalId: approval.id, confirmation, postError };
    });

    if (!submitted.confirmation) {
      await db.update(reports).set({ status: "submitted", approvalId: submitted.approvalId, submittedAt: new Date() }).where(eq(reports.id, report.id));
      throw new Error(`Approve was clicked but no confirmation number could be read (${submitted.postError}). The approval is consumed; verify in the portal before retrying.`);
    }
    await rec.step("action", `Submitted. Confirmation ${submitted.confirmation}`, { page, shotName: "confirmation" });
    await db
      .update(reports)
      .set({ status: "submitted", replicaConfirmation: submitted.confirmation, submittedAt: new Date(), approvalId: submitted.approvalId })
      .where(eq(reports.id, report.id));
    const marked = await db
      .update(staleItems)
      .set({ status: "reported" })
      .where(and(eq(staleItems.companyId, report.companyId), eq(staleItems.status, "to_report"), eq(staleItems.ownerState, report.state.toUpperCase())))
      .returning({ id: staleItems.id });
    rec.setOutput({ phase: "submitted", confirmation: submitted.confirmation, staleItemsMarkedReported: marked.length });
    restoreStatus = undefined;
    await rec.step("done", `Report ${report.id} submitted to the replica portal: ${submitted.confirmation}. ${marked.length} stale items marked reported.`);
    await finishBrowser(rec, browser, driver, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (restoreStatus) {
      await db.update(reports).set({ status: restoreStatus }).where(eq(reports.id, opts.reportId)).catch(() => undefined);
    }
    await rec.step(err instanceof ApprovalTimeoutError ? "approval" : "error", message, { page: browser?.page, shotName: "error" });
    rec.setOutput({ phase: "failed" });
    await finishBrowser(rec, browser, driver, "failed", message);
  } finally {
    releaseRun(key);
  }
}
