import { and, eq, sql } from "drizzle-orm";
import { getDb, migrate, type Db } from "@/db/client";
import { companies, payees, recoveries } from "@/db/schema";
import { assertApproved, requestApprovalPayloadHash, withApproval, type ApprovalRef } from "@/lib/approvals";
import { normalizeName } from "@/lib/payees/normalize";
import { appBaseUrl, guardedGoto, launchFencedBrowser, type FencedBrowser } from "./browser";
import { scriptedDriver, stagehandDriver, type PortalDriver, type ResultRow } from "./driver";
import { finishBrowser } from "./finish";
import { RunRecorder, SCRIPTED_LABEL, type DriveMode } from "./recorder";
import { CLAIM_AGENT, chooseMode, createRun, RECOVERY_AGENT, releaseRun } from "./runs";
import { assertReplicaUrl } from "@/lib/replica/guard";
import { bestVariantScore, buildNameVariants, MATCH_THRESHOLD } from "./variants";

export const RECOVERY_STATES = ["CA", "DE", "TX"] as const;

export interface RecoveryOptions {
  companyId: string;
  states?: readonly string[];
  baseUrl?: string;
}

export interface ClaimPayload extends Record<string, unknown> {
  propertyId: string;
  state: string;
  amountCents: number;
  claimantName: string;
  portalUrl: string;
  contact: string;
  ownerNameOnRecord: string;
  reportedBy: string;
  searchedVariant: string;
}

export function claimApprovalRef(recoveryId: string, payload: unknown): ApprovalRef {
  return { action: "file_claim", subjectId: recoveryId, payload };
}

export interface Candidate {
  row: ResultRow;
  confidence: number;
  variant: string;
  state: string;
}

/** Pure: keep rows at/above the threshold, best score per property id. */
export function selectMatches(rows: readonly ResultRow[], variants: readonly string[], state: string, threshold = MATCH_THRESHOLD): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const row of rows) {
    const s = bestVariantScore(variants, row.ownerName);
    if (!s || s.confidence < threshold) continue;
    const prev = best.get(row.propertyId);
    if (!prev || prev.confidence < s.confidence) best.set(row.propertyId, { row, confidence: s.confidence, variant: s.variant, state });
  }
  return [...best.values()];
}

export function launchRecoveryAgent(opts: RecoveryOptions): Promise<{ runId: string }> {
  return startRecovery(opts).then(({ runId, done }) => {
    done.catch((err) => console.error("[recovery-agent] unhandled:", err));
    return { runId };
  });
}

export async function runRecoveryAgent(opts: RecoveryOptions): Promise<{ runId: string }> {
  const { runId, done } = await startRecovery(opts);
  await done;
  return { runId };
}

async function startRecovery(opts: RecoveryOptions) {
  await migrate();
  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, opts.companyId));
  if (!company) throw new Error(`Company ${opts.companyId} not found.`);
  const mode = chooseMode();
  const runId = await createRun(db, {
    agent: RECOVERY_AGENT,
    key: `recovery:${company.id}`,
    subjectField: "companyId",
    subjectId: company.id,
    companyId: company.id,
    mode,
    modelLabel: mode === "stagehand" ? "stagehand" : "scripted",
    input: { states: opts.states ?? RECOVERY_STATES },
  });
  return { runId, done: executeRecovery(db, runId, opts, mode, company.name) };
}

async function executeRecovery(db: Db, runId: string, opts: RecoveryOptions, mode: DriveMode, companyName: string): Promise<void> {
  const baseUrl = opts.baseUrl ?? appBaseUrl();
  const rec = new RunRecorder(db, runId);
  let browser: FencedBrowser | undefined;
  let driver: PortalDriver | undefined;
  try {
    const states = (opts.states ?? RECOVERY_STATES).map((s) => s.toUpperCase());
    const payeeRows = await db.select({ canonicalName: payees.canonicalName, aliases: payees.aliases }).from(payees).where(eq(payees.companyId, opts.companyId));
    const variants = buildNameVariants(companyName, payeeRows);
    rec.setOutput({ mode, companyId: opts.companyId, states, variants, artifactsDir: rec.dir });
    await rec.step("info", mode === "scripted" ? SCRIPTED_LABEL : `Drive mode: Stagehand (${process.env.STAGEHAND_MODEL ?? "default model"})`, { data: { mode } });
    await rec.step("info", `Name variants to search (${variants.length}): ${variants.join(" | ")}`, { data: { variants } });

    browser = await launchFencedBrowser({ baseUrl, videoDir: rec.dir, rec, mode });
    const { page } = browser;
    driver = mode === "stagehand" ? await stagehandDriver({ page, cdpUrl: browser.cdpUrl!, apiKey: process.env.ANTHROPIC_API_KEY!, rec }) : scriptedDriver(page);

    const created: { id: string; state: string; amountCents: number; propertyId: string; payloadSha256: string }[] = [];
    let alreadyKnown = 0;
    for (const state of states) {
      const portalUrl = `${baseUrl}/replica/${state.toLowerCase()}-search`;
      const found = new Map<string, Candidate>();
      for (const variant of variants) {
        await guardedGoto(page, portalUrl, baseUrl, rec);
        await page.getByTestId("search-name").fill(variant);
        await page.getByTestId("search-submit").click();
        await page.getByTestId("search-results").waitFor();
        assertReplicaUrl(page.url(), baseUrl);
        const rows = await driver.readResults();
        await rec.step("extract", `${state}: searched "${variant}" -> ${rows.length} result row(s)`, { page, shotName: `${state}-${variant.slice(0, 18)}`, data: { state, variant, rows: rows.length } });
        for (const c of selectMatches(rows, variants, state)) {
          const prev = found.get(c.row.propertyId);
          if (!prev || prev.confidence < c.confidence) found.set(c.row.propertyId, c);
        }
      }
      if (found.size === 0) {
        await rec.step("info", `${state}: no match at or above ${MATCH_THRESHOLD}% confidence.`);
        continue;
      }
      for (const c of found.values()) {
        const payload: ClaimPayload = {
          propertyId: c.row.propertyId,
          state,
          amountCents: c.row.amountCents,
          claimantName: companyName,
          portalUrl,
          contact: `ap@${normalizeName(companyName).split(" ")[0] ?? "holder"}.example`,
          ownerNameOnRecord: c.row.ownerName,
          reportedBy: c.row.reportedBy,
          searchedVariant: c.variant,
        };
        const [existing] = await db
          .select({ id: recoveries.id })
          .from(recoveries)
          .where(and(eq(recoveries.companyId, opts.companyId), eq(recoveries.state, state), sql`${recoveries.claimPayload}->>'propertyId' = ${c.row.propertyId}`));
        if (existing) {
          alreadyKnown++;
          await rec.step("info", `${state}: ${c.row.propertyId} already tracked (recovery ${existing.id}); not duplicated.`);
          continue;
        }
        const [row] = await db
          .insert(recoveries)
          .values({
            companyId: opts.companyId,
            state,
            amountCents: c.row.amountCents,
            holderNameFound: c.row.reportedBy,
            matchedNameVariant: c.variant,
            matchConfidence: c.confidence,
            status: "claim_drafted",
            claimPayload: payload,
          })
          .returning({ id: recoveries.id });
        created.push({ id: row!.id, state, amountCents: c.row.amountCents, propertyId: c.row.propertyId, payloadSha256: requestApprovalPayloadHash(payload) });
        await rec.step("info", `${state}: FOUND $${(c.row.amountCents / 100).toFixed(2)} owned by "${c.row.ownerName}" (matched "${c.variant}", ${c.confidence}% confidence). Claim drafted, awaiting human approval.`, { data: { recoveryId: row!.id } });
      }
    }
    rec.setOutput({ created, alreadyKnown, totalCents: created.reduce((s, r) => s + r.amountCents, 0) });
    await rec.step("done", `Recovery search complete: ${created.length} new recovery(ies), ${alreadyKnown} already tracked. No claim was filed; each needs human approval.`);
    await finishBrowser(rec, browser, driver, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rec.step("error", message, { page: browser?.page, shotName: "error" });
    await finishBrowser(rec, browser, driver, "failed", message);
  } finally {
    releaseRun(`recovery:${opts.companyId}`);
  }
}

/* ---------------------------------------------------------------- claim filing */

export class ClaimPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimPreconditionError";
  }
}

async function loadClaimable(db: Db, recoveryId: string) {
  const [r] = await db.select().from(recoveries).where(eq(recoveries.id, recoveryId));
  if (!r) throw new ClaimPreconditionError(`Recovery ${recoveryId} not found.`);
  if (!r.claimPayload) throw new ClaimPreconditionError("Recovery has no drafted claim payload.");
  if (r.status === "claim_submitted" || r.status === "paid" || r.status === "rejected") {
    throw new ClaimPreconditionError(`Recovery is already ${r.status}.`);
  }
  return r;
}

/** Throws ApprovalRequiredError synchronously (before any browser work) when no usable approval exists. */
export async function launchClaimFiling(recoveryId: string, baseUrl?: string): Promise<{ runId: string }> {
  await migrate();
  const db = await getDb();
  const r = await loadClaimable(db, recoveryId);
  await assertApproved(db, claimApprovalRef(r.id, r.claimPayload));
  const mode = chooseMode();
  const runId = await createRun(db, {
    agent: CLAIM_AGENT,
    key: `claim:${r.id}`,
    subjectField: "recoveryId",
    subjectId: r.id,
    companyId: r.companyId,
    mode,
    modelLabel: mode === "stagehand" ? "stagehand" : "scripted",
    input: {},
  });
  void executeClaim(db, runId, r.id, mode, baseUrl).catch((err) => console.error("[claim-agent] unhandled:", err));
  return { runId };
}

/** Files an approved claim and waits for completion. */
export async function fileApprovedClaim(recoveryId: string, baseUrl?: string): Promise<{ runId: string }> {
  const { runId } = await launchClaimFiling(recoveryId, baseUrl);
  await waitForRun(runId);
  return { runId };
}

async function waitForRun(runId: string): Promise<void> {
  const { agentRuns } = await import("@/db/schema");
  const db = await getDb();
  for (;;) {
    const [row] = await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId));
    if (!row || row.status !== "running") return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function executeClaim(db: Db, runId: string, recoveryId: string, mode: DriveMode, baseUrlOpt?: string): Promise<void> {
  const baseUrl = baseUrlOpt ?? appBaseUrl();
  const rec = new RunRecorder(db, runId);
  let browser: FencedBrowser | undefined;
  let driver: PortalDriver | undefined;
  try {
    const r = await loadClaimable(db, recoveryId);
    const payload = r.claimPayload as ClaimPayload;
    rec.setOutput({ mode, recoveryId, artifactsDir: rec.dir });
    await rec.step("info", mode === "scripted" ? SCRIPTED_LABEL : `Drive mode: Stagehand`, { data: { mode } });
    await rec.step("approval", "Human approval on file for this exact claim payload.");
    browser = await launchFencedBrowser({ baseUrl, videoDir: rec.dir, rec, mode });
    const { page } = browser;
    driver = mode === "stagehand" ? await stagehandDriver({ page, cdpUrl: browser.cdpUrl!, apiKey: process.env.ANTHROPIC_API_KEY!, rec }) : scriptedDriver(page);

    await guardedGoto(page, payload.portalUrl, baseUrl, rec);
    await page.getByTestId("search-name").fill(payload.searchedVariant);
    await page.getByTestId("search-submit").click();
    await page.getByTestId("search-results").waitFor();
    const rows = await driver.readResults();
    const target = rows.find((x) => x.propertyId === payload.propertyId);
    if (!target) throw new Error(`Property ${payload.propertyId} is no longer listed on the portal.`);
    if (target.amountCents !== payload.amountCents) throw new Error(`Portal amount ${target.amountCents} differs from the approved claim (${payload.amountCents}); not filing.`);
    await rec.step("extract", `Located ${payload.propertyId} ($${(target.amountCents / 100).toFixed(2)}) in results`, { page, shotName: "result" });
    await driver.clickClaim(payload.propertyId);
    await page.getByTestId("claim-form").waitFor();
    assertReplicaUrl(page.url(), baseUrl);
    await page.getByTestId("claim-business-name").fill(payload.claimantName);
    await page.getByTestId("claim-contact").fill(payload.contact);
    await rec.step("action", "Claim form filled", { page, shotName: "claim-form" });

    const ref = claimApprovalRef(recoveryId, r.claimPayload);
    const out = await withApproval(db, ref, async (approval, ctl) => {
      ctl.markAttempted(); // the click below cannot be undone (M4)
      await page.getByTestId("claim-submit").click();
      let confirmation: string | null = null;
      let postError: string | undefined;
      try {
        await page.getByTestId("claim-confirmation").waitFor({ timeout: 15_000 });
        confirmation = (await page.getByTestId("claim-confirmation").innerText()).trim();
      } catch (err) {
        postError = err instanceof Error ? err.message : String(err);
      }
      return { approvalId: approval.id, confirmation, postError };
    }, {
      onUnknownOutcome: async (e, approval) => {
        await db.update(recoveries).set({ status: "claim_submitted", approvalId: approval.id }).where(eq(recoveries.id, recoveryId));
        await rec.step("error", `Claim submit may have been clicked (${e instanceof Error ? e.message : String(e)}). Verify in the portal before retrying.`);
      },
    });
    if (!out.confirmation) {
      await db.update(recoveries).set({ status: "claim_submitted", approvalId: out.approvalId }).where(eq(recoveries.id, recoveryId));
      throw new Error(`Claim was submitted but no confirmation could be read (${out.postError}). Verify in the portal before retrying.`);
    }
    await db.update(recoveries).set({ status: "claim_submitted", claimConfirmation: out.confirmation, approvalId: out.approvalId }).where(eq(recoveries.id, recoveryId));
    rec.setOutput({ confirmation: out.confirmation });
    await rec.step("done", `Claim filed on the replica portal: ${out.confirmation}`, { page, shotName: "claim-confirmation" });
    await finishBrowser(rec, browser, driver, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rec.step("error", message, { page: browser?.page, shotName: "error" });
    await finishBrowser(rec, browser, driver, "failed", message);
  } finally {
    releaseRun(`claim:${recoveryId}`);
  }
}
