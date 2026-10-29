import type { Page } from "playwright";
import { z } from "zod";
import type { DriveMode, RunRecorder } from "./recorder";

export interface PortalSummary {
  itemCount: number;
  totalCents: number;
  byCode: { code: string; count: number; totalCents: number }[];
}

export interface ResultRow {
  ownerName: string;
  amountCents: number;
  propertyId: string;
  reportedBy: string;
}

export function parseMoneyToCents(text: string): number {
  const n = Number(text.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Unparseable money value: ${JSON.stringify(text)}`);
  return Math.round(n * 100);
}

/** What differs between the model-driven and scripted modes. Everything else (fence, guard, approval) is shared. */
export interface PortalDriver {
  readonly mode: DriveMode;
  /** Human label recorded in the trace and on the run. */
  readonly label: string;
  readSummary(): Promise<PortalSummary>;
  readResults(): Promise<ResultRow[]>;
  clickApprove(): Promise<void>;
  clickClaim(propertyId: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------ deterministic DOM readers (data-testids) */

export async function domSummary(page: Page): Promise<PortalSummary> {
  const itemCount = Number((await page.getByTestId("summary-item-count").innerText()).trim());
  const totalCents = parseMoneyToCents(await page.getByTestId("summary-total").innerText());
  const rows = page.getByTestId("summary-code-row");
  const n = await rows.count();
  const byCode: PortalSummary["byCode"] = [];
  for (let i = 0; i < n; i++) {
    const cells = await rows.nth(i).locator("td").allInnerTexts();
    byCode.push({ code: (cells[0] ?? "").trim(), count: Number((cells[1] ?? "").trim()), totalCents: parseMoneyToCents(cells[2] ?? "") });
  }
  if (!Number.isFinite(itemCount)) throw new Error("Portal summary item count was not a number.");
  return { itemCount, totalCents, byCode };
}

export async function domResults(page: Page): Promise<ResultRow[]> {
  const rows = page.getByTestId("result-row");
  const n = await rows.count();
  const out: ResultRow[] = [];
  for (let i = 0; i < n; i++) {
    const cells = await rows.nth(i).locator("td").allInnerTexts();
    out.push({
      ownerName: (cells[0] ?? "").trim(),
      reportedBy: (cells[2] ?? "").trim(),
      amountCents: parseMoneyToCents(cells[4] ?? ""),
      propertyId: (cells[5] ?? "").trim(),
    });
  }
  return out;
}

/* ------------------------------------------------------------ scripted */

export function scriptedDriver(page: Page): PortalDriver {
  return {
    mode: "scripted",
    label: "SCRIPTED - no model configured",
    readSummary: () => domSummary(page),
    readResults: () => domResults(page),
    clickApprove: async () => {
      await page.getByTestId("approve-submission").click();
    },
    clickClaim: async (propertyId) => {
      const row = page.getByTestId("result-row").filter({ hasText: propertyId });
      await row.getByTestId("claim-button").click();
    },
    close: async () => undefined,
  };
}

/* ------------------------------------------------------------ stagehand */

export const DEFAULT_STAGEHAND_MODEL = "anthropic/claude-sonnet-4-6";

const summarySchema = z.object({
  itemCount: z.number().describe("The 'Number of items' value"),
  totalDollars: z.number().describe("The 'Total amount' in dollars, e.g. 2589.50"),
  byPropertyCode: z.array(z.object({ code: z.string(), count: z.number(), amountDollars: z.number() })),
});

const resultsSchema = z.object({
  results: z.array(
    z.object({
      ownerName: z.string(),
      reportedBy: z.string(),
      amountDollars: z.number(),
      propertyId: z.string(),
    }),
  ),
});

interface StagehandLike {
  init(): Promise<void>;
  close(): Promise<void>;
  act(instruction: string): Promise<unknown>;
  extract<T extends z.ZodTypeAny>(instruction: string, schema: T): Promise<z.infer<T>>;
}

const sameSummary = (a: PortalSummary, b: PortalSummary) =>
  a.itemCount === b.itemCount &&
  a.totalCents === b.totalCents &&
  a.byCode.length === b.byCode.length &&
  a.byCode.every((c) => b.byCode.some((d) => d.code === c.code && d.count === c.count && d.totalCents === c.totalCents));

/**
 * Stagehand attaches to the Playwright-owned (fenced) browser over CDP. The model reads the summary / results
 * and performs the approve/claim clicks; credentials and file uploads stay deterministic so synthetic PII
 * is never sent to the model. A model-extracted summary is cross-checked against the DOM before it can gate a filing.
 */
export async function stagehandDriver(opts: { page: Page; cdpUrl: string; apiKey: string; model?: string; rec: RunRecorder }): Promise<PortalDriver> {
  const model = opts.model ?? process.env.STAGEHAND_MODEL ?? DEFAULT_STAGEHAND_MODEL;
  const { Stagehand } = await import("@browserbasehq/stagehand");
  const sh = new Stagehand({
    env: "LOCAL",
    model: { modelName: model, apiKey: opts.apiKey },
    localBrowserLaunchOptions: { cdpUrl: opts.cdpUrl },
    verbose: 0,
  }) as unknown as StagehandLike;
  await sh.init();
  const { rec, page } = opts;
  return {
    mode: "stagehand",
    label: `STAGEHAND - ${model}`,
    readSummary: async () => {
      const dom = await domSummary(page);
      const m = await sh.extract(
        "Extract the report summary: number of items, total amount in dollars, and the per-property-code breakdown.",
        summarySchema,
      );
      const viaModel: PortalSummary = {
        itemCount: m.itemCount,
        totalCents: Math.round(m.totalDollars * 100),
        byCode: m.byPropertyCode.map((c) => ({ code: c.code, count: c.count, totalCents: Math.round(c.amountDollars * 100) })),
      };
      await rec.step("extract", "Model-extracted summary", { data: { viaModel } });
      if (!sameSummary(viaModel, dom)) {
        throw new Error(`Model-extracted summary disagrees with the page DOM (model ${JSON.stringify(viaModel)} vs DOM ${JSON.stringify(dom)}); refusing to proceed.`);
      }
      return viaModel;
    },
    readResults: async () => {
      const dom = await domResults(page);
      if (dom.length === 0) return dom;
      const m = await sh.extract("Extract every search result row: owner name, reported by, amount in dollars, property ID.", resultsSchema);
      const viaModel = m.results.map((r) => ({ ...r, amountCents: Math.round(r.amountDollars * 100) }));
      const ok = viaModel.length === dom.length && viaModel.every((r) => dom.some((d) => d.propertyId === r.propertyId && d.amountCents === r.amountCents));
      if (!ok) throw new Error("Model-extracted search results disagree with the page DOM; refusing to proceed.");
      return dom;
    },
    clickApprove: async () => {
      await sh.act("Click the 'Approve submission' button");
    },
    clickClaim: async (propertyId) => {
      await sh.act(`Click the 'Claim this property' button in the row whose Property ID is ${propertyId}`);
    },
    close: () => sh.close().catch(() => undefined),
  };
}
