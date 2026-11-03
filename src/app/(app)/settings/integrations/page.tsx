import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { connection } from "next/server";
import { Skel } from "@/components/b/Skel";
import { InstrumentLabel, PageHeader, Section } from "@/components/primitives";
import { OwnerLinkNotices } from "@/components/settings/OwnerLinkNotices";
import { Preferences } from "@/components/settings/Preferences";
import { ServiceRows } from "@/components/settings/ServiceRows";
import { ConnectionDiagram } from "@/components/viz/connection-diagram/ConnectionDiagram";
import { buildDiagram } from "@/components/viz/connection-diagram/model";
import { IntegrationsPanel } from "./integrations-panel";
import { loadSettingsData } from "./snapshot";

export const metadata: Metadata = { title: "Integrations" };

/** One config read per request, shared by the diagram and the rows. */
const load = cache(async () => {
  await connection(); // env flags and stored connections are request-time data
  return loadSettingsData();
});

async function DiagramHero() {
  const { snapshot } = await load();
  return <ConnectionDiagram nodes={buildDiagram(snapshot)} />;
}

async function OutputsAndEngine() {
  const { snapshot } = await load();
  const nodes = buildDiagram(snapshot).filter((n) => n.group !== "input");
  return <ServiceRows nodes={nodes} snapshot={snapshot} />;
}

async function OwnerLinks() {
  const { ownerLinks } = await load();
  return <OwnerLinkNotices state={ownerLinks} />;
}

function RowsSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skel className="h-4 w-40" />
          <Skel className="h-3 w-72 max-w-full" />
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <section aria-labelledby="page-heading" className="max-w-5xl">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="What this prototype is connected to, read from the server's configuration. Sandboxes and test modes only; nothing is sent from this page."
      />

      <div className="mb-12">
        <InstrumentLabel as="p" className="mb-3">
          Connections
        </InstrumentLabel>
        <Suspense fallback={<Skel className="h-[260px] rounded-[10px] sm:h-[400px]" />}>
          <DiagramHero />
        </Suspense>
        <p className="mt-3 max-w-3xl text-xs text-fg-3">
          Solid thread: set up. Dotted: simulated (offline or local). Dashed: not set up. &ldquo;Keys present&rdquo; means the settings exist; it is not a live check.
        </p>
      </div>

      <div className="max-w-3xl space-y-12">
        <Section title="Sources" id="settings-sources">
          <IntegrationsPanel />
        </Section>

        <Section title="Outputs and engine" id="settings-outputs">
          <Suspense fallback={<RowsSkeleton rows={5} label="Loading service status" />}>
            <OutputsAndEngine />
          </Suspense>
        </Section>

        <Section title="Owner reply links" id="settings-owner-links">
          <Suspense fallback={<RowsSkeleton rows={2} label="Loading owner link settings" />}>
            <OwnerLinks />
          </Suspense>
        </Section>

        <Section title="Preferences" id="settings-preferences">
          <Preferences />
        </Section>
      </div>
    </section>
  );
}
