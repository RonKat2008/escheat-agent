/**
 * Bulk draft dry-run preview, as a pure view-model: "12 will be drafted, 5 skipped", with skips grouped by reason.
 * Decisions and messages come from the server's plan (POST /api/outreach/bulk-draft {dryRun:true}); this only groups.
 */
import type { DraftSkipCode, PlanEntry } from "@/lib/outreach/bulk-plan";
import { plural } from "@/lib/format";

export const SKIP_LABEL: Record<DraftSkipCode, string> = {
  rule_unknown: "A required rule value is unknown",
  notice_not_required: "No owner notice required (below the state minimum)",
  window_not_open: "Due-diligence window not open yet",
  already_drafted: "Already has a letter",
  closed: "Item is closed or already reported",
  missing_owner_address: "No owner mailing address on file",
  owner_state_unknown: "Owner state unknown",
  not_found: "Item not found",
};

export interface PreviewRowInfo {
  payeeName: string;
  checkNumber: string | null;
}

export interface SkipGroupEntry extends PreviewRowInfo {
  staleItemId: string;
  message: string;
}

export interface SkipGroup {
  code: DraftSkipCode;
  label: string;
  entries: SkipGroupEntry[];
}

export interface PlanPreview {
  total: number;
  willDraft: string[];
  skipped: number;
  groups: SkipGroup[];
  title: string;
}

export function previewTitle(willDraft: number, skipped: number): string {
  return `${willDraft} will be drafted, ${skipped} skipped`;
}

/** Groups skip entries by code (largest group first, then label), keeping the server's per-item message. */
export function groupPlan(plan: readonly PlanEntry[], rows: ReadonlyMap<string, PreviewRowInfo>): PlanPreview {
  const willDraft: string[] = [];
  const by = new Map<DraftSkipCode, SkipGroupEntry[]>();
  for (const e of plan) {
    if (e.decision === "will_draft") {
      willDraft.push(e.staleItemId);
      continue;
    }
    const info = rows.get(e.staleItemId) ?? { payeeName: "Unknown item", checkNumber: null };
    by.set(e.code, [...(by.get(e.code) ?? []), { staleItemId: e.staleItemId, message: e.message, ...info }]);
  }
  const groups = [...by.entries()]
    .map(([code, entries]) => ({ code, label: SKIP_LABEL[code] ?? code, entries }))
    .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
  const skipped = plan.length - willDraft.length;
  return { total: plan.length, willDraft, skipped, groups, title: previewTitle(willDraft.length, skipped) };
}

/** Confirm button copy: "Draft 12 letters". */
export function confirmLabel(n: number): string {
  return `Draft ${plural(n, "letter")}`;
}

/** Splits ids into request-sized chunks (the API takes at most `size` per call). */
export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
