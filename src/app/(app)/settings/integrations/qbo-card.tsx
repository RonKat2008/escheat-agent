"use client";

import { Button } from "@/components/ui/button";
import { IntegrationCard, type CardState } from "./integration-card";
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
    <IntegrationCard
      title="QuickBooks Online"
      description="Sandbox only. Pulls check payments into the ledger."
      state={state}
      envHint="Add QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI to .env.local (and QBO_TOKEN_SECRET or OWNER_LINK_SECRET to encrypt stored tokens)."
    >
      {state !== "loading" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={state === "connected" ? "outline" : "default"}
            nativeButton={false}
            render={<a href={`/api/integrations/qbo/connect${status?.companyId ? `?companyId=${status.companyId}` : ""}`} />}
          >
            {state === "connected" ? "Reconnect" : "Connect QuickBooks"}
          </Button>
          {state === "connected" && (
            <Button onClick={onPull} disabled={pull.busy}>
              {pull.busy ? "Pulling checks..." : "Pull checks"}
            </Button>
          )}
        </div>
      )}
      {status?.qbo.realmId && <p className="font-mono text-xs text-muted-foreground">realm {status.qbo.realmId}</p>}
      {pull.message && (
        <p role={pull.isError ? "alert" : "status"} className={pull.isError ? "text-pink-400" : "text-blue-400"}>
          {pull.message}
        </p>
      )}
    </IntegrationCard>
  );
}
