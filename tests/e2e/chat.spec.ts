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
    await expect(examples.filter({ hasText: "What do we owe and where?" })).toBeVisible();
    await expect(examples.filter({ hasText: "What's due in the next 90 days?" })).toBeVisible();
    expect(await examples.count()).toBeLessThanOrEqual(6);

    await expect(page.getByTestId("chat-not-configured")).toContainText("Chat needs ANTHROPIC_API_KEY");
    // The input stays typeable for the no-model setup cards, but a free question cannot be sent.
    await page.getByTestId("chat-input").fill("What do we owe and where?");
    await expect(page.getByTestId("chat-send")).toBeDisabled();
    await expect(page.getByTestId("chat-no-model-hint")).toBeVisible();
    await expect(examples.filter({ hasText: "What do we owe and where?" })).toBeDisabled();
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
