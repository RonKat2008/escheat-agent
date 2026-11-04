import { expect, type APIRequestContext, type Page } from "playwright/test";

/**
 * Skip codes the single-item draft path may still draft (src/lib/outreach/draft.ts refuses "closed" and
 * "window_not_open", also when an advisory code such as rule_unknown is listed first): the letter is stored but its
 * readiness shows the problem, for example the UNKNOWN TX notice language. "already_drafted" items already list
 * outreach, so they are no use for a fresh draft.
 */
const MAY_DRAFT = new Set(["rule_unknown", "missing_owner_address", "owner_state_unknown", "notice_not_required"]);

/**
 * Stale item ids a drawer "Draft outreach" click may draft right now, asked of the server's own dry run instead of
 * guessed from the seed. On the ui server every item whose due-diligence window is open already carries the
 * pipeline's auto-drafted letter, so the fresh candidates are mostly items with no window on file (rule UNKNOWN).
 */
export async function draftableItemIds(request: APIRequestContext, staleItemIds: readonly string[]): Promise<string[]> {
  const dry = await request.post("/api/outreach/bulk-draft", { data: { channel: "letter", staleItemIds: staleItemIds.slice(0, 50), dryRun: true } });
  expect(dry.ok(), `dry run: ${dry.status()}`).toBe(true);
  const { plan } = (await dry.json()) as { plan: { staleItemId: string; decision: string; code?: string }[] };
  const fresh = plan.filter((p) => p.decision === "will_draft");
  const maybe = plan.filter((p) => p.decision === "skip" && MAY_DRAFT.has(p.code ?? ""));
  return [...fresh, ...maybe].map((p) => p.staleItemId);
}

/**
 * Opens each candidate's drawer and clicks "Draft outreach" on the first one that lists no outreach yet, until the
 * server drafts one; a refusal is shown plainly and the next candidate is tried. Returns the drafted id, or null.
 */
export async function draftFromFirstDrawer(page: Page, candidates: readonly string[]): Promise<string | null> {
  const drawer = page.getByTestId("item-drawer");
  for (const id of candidates) {
    await page.goto(`/items?item=${id}`);
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByTestId("drawer-draft").or(drawer.getByText(/No outreach yet/)).first()).toBeVisible({ timeout: 30_000 });
    if ((await drawer.getByText(/No outreach yet/).count()) === 0) continue;
    await drawer.getByRole("button", { name: "Draft outreach" }).click();
    const outcome = await Promise.race([
      drawer.getByRole("link", { name: "Review in approvals" }).waitFor({ timeout: 60_000 }).then(() => "drafted" as const),
      drawer.getByTestId("draft-refused").waitFor({ timeout: 60_000 }).then(() => "refused" as const),
    ]);
    if (outcome === "drafted") return id;
    await expect(drawer.getByTestId("draft-refused")).toContainText("Not drafted:");
  }
  return null;
}
