import { z } from "zod";

export const REPLICA_STATES = ["ca", "de", "tx"] as const;
export type ReplicaState = (typeof REPLICA_STATES)[number];
export type PortalKind = "holder" | "search";

export const PORTAL_SLUGS = REPLICA_STATES.flatMap((st) => [`${st}-holder`, `${st}-search`] as const);

export interface Portal {
  slug: string;
  state: ReplicaState;
  /** Upper-case two-letter code, e.g. "CA". */
  stateCode: string;
  kind: PortalKind;
  stateName: string;
  /** Plain-text agency line. Never a real agency name or seal. */
  agencyTitle: string;
}

const STATE_NAMES: Record<ReplicaState, string> = {
  ca: "California",
  de: "Delaware",
  tx: "Texas",
};

const portalSlugSchema = z
  .string()
  .regex(/^(ca|de|tx)-(holder|search)$/);

/** Returns the portal for a URL slug, or null for anything else (callers 404). */
export function parsePortal(slug: unknown): Portal | null {
  const parsed = portalSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const [st, kind] = parsed.data.split("-") as [ReplicaState, PortalKind];
  const stateName = STATE_NAMES[st];
  return {
    slug: parsed.data,
    state: st,
    stateCode: st.toUpperCase(),
    kind,
    stateName,
    agencyTitle: `State of ${stateName} - Unclaimed Property (REPLICA)`,
  };
}

export function portalHref(portal: Pick<Portal, "slug">, ...rest: string[]): string {
  return ["/replica", portal.slug, ...rest].join("/");
}

export const stateSchema = z.enum(REPLICA_STATES);
