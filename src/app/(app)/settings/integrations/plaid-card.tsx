"use client";

import { Button } from "@/components/ui/button";
import { IntegrationRow, type CardState } from "./integration-card";
import type { IntegrationStatus } from "./integrations-panel";
import { useAction } from "./use-action";

export function PlaidCard({ status, onChanged }: { status: IntegrationStatus | null; onChanged: () => void }) {
  const act = useAction();
  const state: CardState = !status
    ? "loading"
    : !status.plaid.configured
      ? "not-configured"
      : status.plaid.connected
        ? "connected"
        : "disconnected";

  async function connectSandbox() {
    const r = await act.run("/api/integrations/plaid/exchange", { companyId: status?.companyId, sandbox: true });
    if (r) {
      act.report("Connected to the Plaid sandbox bank.");
      onChanged();
    }
  }

  async function sync() {
    const r = await act.run("/api/integrations/plaid/sync", { companyId: status?.companyId });
    if (r) {
      act.report(`Synced ${r.transactions} transactions: ${r.inserted} check clears added, ${r.skipped} already stored.`);
      onChanged();
    }
  }

  return (
    <IntegrationRow
      title="Plaid"
      description="Sandbox only. Syncs bank debits that look like cleared checks. Plaid sandbox rarely returns check numbers; clears then match on amount and date."
      state={state}
      envVars={["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV=sandbox", "QBO_TOKEN_SECRET (or OWNER_LINK_SECRET) as the token secret"]}
      actions={
        <>
          {state === "disconnected" && (
            <Button variant="outline" onClick={connectSandbox} disabled={act.busy}>
              Connect sandbox bank
            </Button>
          )}
          {state === "connected" && (
            <Button variant="outline" onClick={sync} disabled={act.busy}>
              {act.busy ? "Syncing..." : "Sync clears"}
            </Button>
          )}
        </>
      }
    >
      {act.message && (
        <p role={act.isError ? "alert" : "status"} className={act.isError ? "text-pink-400" : "text-blue-400"}>
          {act.message}
        </p>
      )}
    </IntegrationRow>
  );
}
