import { PageHeader } from "@/components/primitives";
import { IntegrationsPanel } from "./integrations-panel";

export const metadata = { title: "Integrations" };

export default function Page() {
  return (
    <section aria-labelledby="page-heading" className="max-w-3xl">
      <PageHeader
        title="Integrations"
        description="Bring check registers and bank clears in from QuickBooks Online and Plaid sandboxes, or upload a CSV."
      />
      <IntegrationsPanel />
    </section>
  );
}
