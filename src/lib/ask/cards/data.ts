/**
 * Server-side reads behind the Ask action cards. Every number is a count over real rows or the rules engine's own
 * output; nothing here computes a legal date or value. Integration status is by env var PRESENCE only: values are
 * never read into the result (see integrationRows and its sentinel test).
 */
import { and, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, reports } from "@/db/schema";
import { integrationStatuses } from "@/lib/setup/integrations";
import { listRuleStates, tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import type { GettingStartedStep, IntegrationCardRow } from "@/lib/chat/ui-types";
import { CARD_PROMPT } from "./registry";

/** Outreach a person has approved (or that went further after approval). */
const APPROVED_OUTREACH = ["approved", "sent", "delivered", "responded"] as const;
/** Reports a person filed with the (replica) state portal. */
const FILED_REPORTS = ["submitted", "confirmed"] as const;

/**
 * One row per optional integration: its state and the NAMES still missing. `env` is any name -> value map; only
 * whether a value is non-empty is read, and no value is copied into the output.
 */
export function integrationRows(env: Readonly<Record<string, string | undefined>>): IntegrationCardRow[] {
  const present: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === "string" && value.trim() !== "") present[name] = "1";
  return integrationStatuses(present).map((s) => ({
    id: s.id,
    label: s.label,
    state: s.state,
    required: [...s.required],
    missing: [...s.missing],
    fallback: s.fallback,
  }));
}

export interface OnboardingCounts {
  ledgerRows: number;
  /** Rule values across every pinned rule file that no person has verified yet. */
  unverifiedRules: number;
  ruleStates: number;
  approvedLetters: number;
  filedReports: number;
}

export function unverifiedRuleCount(): { unverified: number; states: number } {
  let unverified = 0;
  let states = 0;
  for (const state of listRuleStates()) {
    const loaded = tryLoadRules(state);
    if (!loaded) continue;
    states += 1;
    unverified += listRuleValues(loaded.file).filter((v) => !v.rv.verified).length;
  }
  return { unverified, states };
}

export async function loadOnboardingCounts(db: Db, companyId: string): Promise<OnboardingCounts> {
  const n = (rows: { n: number | string }[]) => Number(rows[0]?.n ?? 0);
  const [ledger, letters, filed] = await Promise.all([
    db.select({ n: count() }).from(ledgerItems).where(eq(ledgerItems.companyId, companyId)),
    db
      .select({ n: count() })
      .from(outreach)
      .where(and(eq(outreach.companyId, companyId), eq(outreach.channel, "letter"), inArray(outreach.status, [...APPROVED_OUTREACH]))),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), inArray(reports.status, [...FILED_REPORTS]))),
  ]);
  const rules = unverifiedRuleCount();
  return { ledgerRows: n(ledger), unverifiedRules: rules.unverified, ruleStates: rules.states, approvedLetters: n(letters), filedReports: n(filed) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The onboarding checklist, in the order a new person does it. Pure: tested against hand-built counts. */
export function gettingStartedSteps(c: OnboardingCounts): GettingStartedStep[] {
  return [
    {
      id: "data",
      title: "Load your ledger",
      detail: c.ledgerRows > 0 ? `${plural(c.ledgerRows, "ledger row")} loaded.` : "No ledger rows yet. Upload a check register CSV to begin.",
      done: c.ledgerRows > 0,
      href: "/settings/integrations",
      linkLabel: "Open Integrations",
      askPrompt: CARD_PROMPT.import_csv,
    },
    {
      id: "rules",
      title: "Review the rules",
      detail:
        c.ruleStates === 0
          ? "No rule files are loaded."
          : c.unverifiedRules > 0
            ? `${plural(c.unverifiedRules, "rule value")} still UNVERIFIED across ${plural(c.ruleStates, "state")}. Only a person can verify them.`
            : `Every rule value in ${plural(c.ruleStates, "state")} is verified by a person.`,
      done: c.ruleStates > 0 && c.unverifiedRules === 0,
      href: "/rules",
      linkLabel: "Open Rules",
      askPrompt: null,
    },
    {
      id: "letter",
      title: "Approve your first letter",
      detail: c.approvedLetters > 0 ? `${plural(c.approvedLetters, "letter")} approved by a person.` : "No letter has been approved yet. Drafts wait in Approvals.",
      done: c.approvedLetters > 0,
      href: "/approvals",
      linkLabel: "Open Approvals",
      askPrompt: null,
    },
    {
      id: "filing",
      title: "File your first report",
      detail: c.filedReports > 0 ? `${plural(c.filedReports, "report")} filed with a replica state portal.` : "No report has been filed yet. Filing needs a person's approval first.",
      done: c.filedReports > 0,
      href: "/reports",
      linkLabel: "Open Reports",
      askPrompt: null,
    },
  ];
}
