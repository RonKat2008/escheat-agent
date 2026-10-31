import { expect, test } from "playwright/test";

/**
 * The e2e server scrubs ANTHROPIC_API_KEY, so /chat must show its honest not-configured state:
 * the example prompts render, the input is disabled, and the API refuses instead of answering.
 */
test.describe("chat", () => {
  test("renders the empty state with example prompts and the not-configured notice", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: "Ask about your unclaimed property" })).toBeVisible();
    const examples = page.getByTestId("chat-example");
    await expect(examples).toHaveCount(6);
    await expect(examples.filter({ hasText: "What do we owe and where?" })).toBeVisible();
    await expect(examples.filter({ hasText: "Draft the due-diligence letter for #10482" })).toBeVisible();

    await expect(page.getByTestId("chat-not-configured")).toContainText("Chat needs ANTHROPIC_API_KEY");
    await expect(page.getByTestId("chat-input")).toBeDisabled();
    await expect(examples.first()).toBeDisabled();
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
