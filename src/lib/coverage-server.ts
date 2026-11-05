import { listRuleStates } from "@/lib/rules/load";

/** States with a rules file loaded: the only ones the app can date and file ("in scope"). Server only (reads the rules dir). */
export const inScopeStates = (): string[] => listRuleStates();
