import { expect, test } from "playwright/test";

/**
 * The e2e server scrubs ANTHROPIC_API_KEY, so chat (now Ask: /chat redirects to /ask) must show its honest
 * not-configured state: the starter prompts render, a free question cannot be sent (only the no-model setup cards
 * can), and the API refuses instead of answering.
 */
test.describe("chat", () => {
  test("renders the empty state with example prompts and the not-configured notice", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/ask$/);
    await expect(page.getByRole("heading", { level: 1, name: /What do you want\s*to get done\?/ })).toBeVisible();
    const examples = page.getByTestId("chat-example");
    // R11-05: with no key the chips are the cards that work, in golden-path order, none disabled.
    const labels = (await examples.allInnerTexts()).map((t) => t.split("·")[0]!.trim());
    expect(labels).toEqual(["Get started", "Upload a ledger CSV", "Draft letters", "What needs my approval?", "Close the month", expect.stringMatching(/^File the (CA|DE|TX) report$/)]);
    for (const chip of await examples.all()) await expect(chip).toBeEnabled();

    await expect(page.getByTestId("chat-not-configured")).toContainText("Chat needs ANTHROPIC_API_KEY");
    // The input stays typeable for the no-model setup cards, but a free question cannot be sent.
    await page.getByTestId("chat-input").fill("What do we owe and where?");
    await expect(page.getByTestId("chat-send")).toBeDisabled();
    await expect(page.getByTestId("chat-no-model-hint")).toBeVisible();
    // R11-05: the hint names every card, generated from the registry.
    for (const phrase of ["Get started", "Upload a ledger CSV", "What's overdue?", "Set up integrations", "Review approvals", "Draft letters", "Close the month", "File the CA report"]) {
      await expect(page.getByTestId("chat-no-model-hint")).toContainText(phrase);
    }
    await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.").first()).toBeVisible();
  });

  test("the chat API refuses honestly without a key", async ({ page }) => {
    await page.goto("/chat");
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text: "What do we owe and where?" }] }),
      });
      return { status: r.status, body: (await r.json()) as { code?: string } };
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("not_configured");
  });

  test("lays out at 375px without horizontal overflow and keeps the disclaimer on screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/chat");
    await expect(page.getByTestId("chat-input")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const disclaimer = page.locator("footer").getByText("Prototype. Not legal advice.", { exact: false });
    await expect(disclaimer).toBeInViewport();
    await expect(page.getByTestId("chat-input")).toBeInViewport();
  });
});
