import {
  bankClears,
  companies,
  evalCases,
  evalResults,
  evalRuns,
  ledgerItems,
  payees,
  simClock,
  staleItems,
  agentRuns,
  recoveries,
  reports,
  outreach,
  approvals,
  ruleChanges,
  replicaSubmissions,
  replicaClaims,
  integrationConnections,
} from "../../db/schema";
import type { Db } from "../../db/client";
import type { EvalCaseFixture, SyntheticDataset } from "./model";

export interface SeedCounts {
  companies: number;
  payees: number;
  ledgerItems: number;
  bankClears: number;
  evalCases: number;
}

const CHUNK = 200;

async function insertChunks<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/**
 * Wipe app rows (FK-safe order; reference tables state_rules / rule_changes are kept) and load the
 * synthetic company, payees (one per distinct raw name), raw ledger items and bank clears, and eval cases.
 * Ledger items are loaded unreconciled: status is 'outstanding' (or 'voided' when the ledger says so);
 * linking clears to items and detecting staleness is the recon pipeline's job.
 */
export async function seedDemo(
  db: Db,
  dataset: SyntheticDataset,
  cases: readonly EvalCaseFixture[],
): Promise<SeedCounts> {
  return db.transaction(async (tx) => {
    for (const table of [
      evalResults, evalRuns, evalCases, simClock, agentRuns, recoveries, reports, outreach,
      approvals, staleItems, bankClears, ledgerItems, payees, integrationConnections, replicaSubmissions, replicaClaims, ruleChanges,
      companies,
    ]) {
      await tx.delete(table);
    }
    const c = dataset.company;
    const [company] = await tx
      .insert(companies)
      .values({
        name: c.name,
        incorporationState: c.incorporation_state,
        hqState: c.hq_state,
        addressLine: c.address_line,
        city: c.city,
        zip: c.zip,
        fein: null,
        isSynthetic: true,
      })
      .returning({ id: companies.id });
    if (!company) throw new Error("company insert returned no row");
    const companyId = company.id;

    // One payee per distinct raw name; address taken from the first row that has any address text.
    const firstByName = new Map<string, (typeof dataset.ledger)[number]>();
    for (const r of dataset.ledger) {
      const prev = firstByName.get(r.payee_name);
      const hasAddr = (x: typeof r) => Boolean(x.payee_address || x.payee_city || x.payee_state || x.payee_zip);
      if (!prev || (!hasAddr(prev) && hasAddr(r))) firstByName.set(r.payee_name, r);
    }
    const payeeIds = new Map<string, string>();
    const payeeRows = [...firstByName.values()];
    await insertChunks(payeeRows, async (chunk) => {
      const inserted = await tx
        .insert(payees)
        .values(
          chunk.map((r) => ({
            companyId,
            canonicalName: r.payee_name,
            aliases: [] as string[],
            addressLine: r.payee_address || null,
            city: r.payee_city || null,
            state: r.payee_state || null,
            zip: r.payee_zip || null,
            mergeBasis: "exact" as const,
          })),
        )
        .returning({ id: payees.id, name: payees.canonicalName });
      for (const p of inserted) payeeIds.set(p.name, p.id);
    });

    await insertChunks(dataset.ledger, (chunk) =>
      tx.insert(ledgerItems).values(
        chunk.map((r) => ({
          companyId,
          payeeId: payeeIds.get(r.payee_name) ?? null,
          payeeNameRaw: r.payee_name,
          propertyType: r.kind,
          referenceNumber: r.number,
          amountCents: r.amount_cents,
          issueDate: r.issue_date,
          status: r.voided ? ("voided" as const) : ("outstanding" as const),
          addressLine: r.payee_address || null,
          city: r.payee_city || null,
          state: r.payee_state || null,
          zip: r.payee_zip || null,
          memo: r.memo || null,
          rawRow: { ...r, source: "synthetic" },
        })),
      ),
    );

    await insertChunks(dataset.clears, (chunk) =>
      tx.insert(bankClears).values(
        chunk.map((r) => ({
          companyId,
          referenceNumber: r.check_number,
          amountCents: r.amount_cents,
          clearedDate: r.cleared_date,
          description: r.description,
        })),
      ),
    );

    await insertChunks(cases, (chunk) =>
      tx.insert(evalCases).values(
        chunk.map((k) => ({
          slice: k.slice,
          itemSnapshot: { caseId: k.id, ...k.item },
          expected: { ...k.expected },
        })),
      ),
    );

    return {
      companies: 1,
      payees: payeeRows.length,
      ledgerItems: dataset.ledger.length,
      bankClears: dataset.clears.length,
      evalCases: cases.length,
    };
  });
}
