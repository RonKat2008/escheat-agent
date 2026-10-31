import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type CardState = "loading" | "not-configured" | "disconnected" | "connected";

const STATE_LABEL: Record<CardState, string> = {
  loading: "Checking",
  "not-configured": "Not configured",
  disconnected: "Not connected",
  connected: "Connected",
};

export function IntegrationCard({
  title,
  description,
  state,
  envHint,
  children,
}: {
  title: string;
  description: string;
  state?: CardState;
  /** shown only in the not-configured state */
  envHint?: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          {title}
          {state && (
            <Badge
              variant="outline"
              className={state === "connected" ? "border-blue-800 text-blue-400" : "text-muted-foreground"}
            >
              {STATE_LABEL[state]}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === "not-configured" ? (
          <p className="rounded-md border border-line bg-ink-1 p-3 text-muted-foreground">
            Not configured. {envHint}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
