import type { Locator, Page } from "playwright/test";

/** R5-10: the "Approving as" field starts empty on every gate, so a spec must type the approver explicitly. */
export const E2E_APPROVER = "Test Reviewer";

export async function fillApprover(scope: Page | Locator, name: string = E2E_APPROVER): Promise<void> {
  await scope.getByLabel("Approving as").fill(name);
}
