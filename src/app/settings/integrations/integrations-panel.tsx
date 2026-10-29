"use client";

import { useCallback, useEffect, useState } from "react";
import { CsvCard } from "./csv-card";
import { PlaidCard } from "./plaid-card";
import { QboCard } from "./qbo-card";

export interface IntegrationStatus {
  companyId: string | null;
  qbo: { configured: boolean; connected: boolean; realmId: string | null };
  plaid: { configured: boolean; connected: boolean };
}

export function IntegrationsPanel() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    fetch("/api/integrations/status")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as IntegrationStatus;
      })
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load status");
      });
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          Could not load integration status ({error}).
        </p>
      )}
      {status && !status.companyId && (
        <p className="text-sm text-muted-foreground">No company exists yet. Run the demo seed first.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <QboCard status={status} onChanged={refresh} />
        <PlaidCard status={status} onChanged={refresh} />
      </div>
      <CsvCard companyId={status?.companyId ?? null} />
    </div>
  );
}
