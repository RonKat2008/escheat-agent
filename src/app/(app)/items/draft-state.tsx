"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** The draft the server just created from this drawer (its real outreach id), until the refreshed list includes it. */
export interface JustDrafted {
  outreachId: string;
  channel: string;
  ready: boolean;
}

interface DraftState {
  drafted: JustDrafted | null;
  setDrafted: (d: JustDrafted) => void;
}

const Ctx = createContext<DraftState>({ drafted: null, setDrafted: () => undefined });

/**
 * Shares one drawer's draft result between the header's Draft button and the Outreach list (F29): the list shows the
 * new letter the moment the server answers, then router.refresh() replaces it with the stored row. Keyed per item.
 */
export function DraftStateProvider({ children }: { children: ReactNode }) {
  const [drafted, setDrafted] = useState<JustDrafted | null>(null);
  return <Ctx.Provider value={{ drafted, setDrafted }}>{children}</Ctx.Provider>;
}

export function useDraftState(): DraftState {
  return useContext(Ctx);
}
