import { notFound } from "next/navigation";
import { parsePortal, type Portal, type PortalKind } from "@/lib/replica/portal";

/** Resolve a [portal] param, 404 when it is not one of the six portals or not the expected kind. */
export async function resolvePortal(params: Promise<{ portal: string }>, kind?: PortalKind): Promise<Portal> {
  const { portal: slug } = await params;
  const portal = parsePortal(slug);
  if (!portal || (kind && portal.kind !== kind)) notFound();
  return portal;
}

export function Money({ cents }: { cents: number }) {
  return <>{(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</>;
}
