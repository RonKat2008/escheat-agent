"use client";

import { Button } from "@/components/ui/button";
import { IntegrationRow, type CardState } from "./integration-card";
import type { IntegrationStatus } from "./integrations-panel";
import { useAction } from "./use-action";

export function QboCard({ status, onChanged }: { status: IntegrationStatus | null; onChanged: () => void }) {
  const pull = useAction();
  const state: CardState = !status
    ? "loading"
    : !status.qbo.configured
      ? "not-configured"
      : status.qbo.connected
        ? "connected"
        : "disconnected";

  async function onPull() {
    const r = await pull.run("/api/integrations/qbo/pull", { companyId: status?.companyId });
    if (r) {
      pull.report(`Fetched ${r.fetched}, inserted ${r.inserted}, skipped ${r.skipped}, voided ${r.voided}.`);
      onChanged();
    }
  }

  return (
    <IntegrationRow
      title="QuickBooks Online"
      description="Sandbox only. Pulls check payments into the ledger."
      state={state}
      detail={status?.qbo.realmId ? <span className="font-mono text-xs">realm {status.qbo.realmId}</span> : null}
      envVars={["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI", "QBO_TOKEN_SECRET (or OWNER_LINK_SECRET) to encrypt stored tokens"]}
      actions={
        state !== "loading" ? (
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/integrations/qbo/connect${status?.companyId ? `?companyId=${status.companyId}` : ""}`} />}
            >
              {state === "connected" ? "Reconnect" : "Connect QuickBooks"}
            </Button>
            {state === "connected" && (
              <Button variant="outline" onClick={onPull} disabled={pull.busy}>
                {pull.busy ? "Pulling checks..." : "Pull checks"}
              </Button>
            )}
          </>
        ) : null
      }
    >
      {pull.message && (
        <p role={pull.isError ? "alert" : "status"} className={pull.isError ? "text-pink-400" : "text-blue-400"}>
          {pull.message}
        </p>
      )}
    </IntegrationRow>
  );
}
