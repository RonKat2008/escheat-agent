import type { APIRequestContext, APIResponse, Locator, Page } from "playwright/test";

/** R5-10: the "Approving as" field starts empty on every gate, so a spec must type the approver explicitly. */
export const E2E_APPROVER = "Test Reviewer";

export async function fillApprover(scope: Page | Locator, name: string = E2E_APPROVER): Promise<void> {
  await scope.getByLabel("Approving as").fill(name);
}

/**
 * Approves a report through the API the way the UI does: the first try carries no acknowledgement; if the server says
 * the file relies on unverified rules / never-sent notices ("approve anyway"), repeat with exactly the counts it names.
 */
export async function approveReportApi(
  request: APIRequestContext,
  reportId: string,
  expectedChecksum: string,
  approvedBy: string = E2E_APPROVER,
): Promise<APIResponse> {
  const post = (extra: Record<string, unknown>) => request.post(`/api/reports/${reportId}/approve`, { data: { approvedBy, expectedChecksum, ...extra } });
  const first = await post({});
  if (first.status() !== 409) return first;
  const body = (await first.json()) as { required?: { unverified: number; unsent: number } | null };
  if (!body.required) return first;
  return post({ acknowledgedUnverified: body.required.unverified, acknowledgedUnsent: body.required.unsent });
}
