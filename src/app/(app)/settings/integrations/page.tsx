import { IntegrationsPanel } from "./integrations-panel";

export const metadata = { title: "Integrations" };

export default function Page() {
  return (
    <section aria-labelledby="page-heading" className="space-y-6">
      <header className="space-y-1">
        <h1 id="page-heading" className="text-2xl font-semibold tracking-tight">
          Integrations
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Bring check registers and bank clears in from QuickBooks Online and Plaid sandboxes, or upload a CSV.
        </p>
      </header>
      <IntegrationsPanel />
    </section>
  );
}
