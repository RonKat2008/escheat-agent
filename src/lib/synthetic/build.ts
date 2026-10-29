import { buildAdversarialCases } from "./adversarial";
import { sampleGeneratedCases } from "./eval-generated";
import { generateSynthetic } from "./generate";
import { generateReplicaFixture } from "./replica";
import { DEFAULT_SEED, DEMO_ANCHOR_DATE, type EvalCaseFixture, type SyntheticDataset } from "./model";
import { clearsToCsv, ledgerToCsv } from "./csv";
import type { ReplicaFixture } from "./replica";

export interface SyntheticBundle {
  dataset: SyntheticDataset;
  ledgerCsv: string;
  clearsCsv: string;
  generatedCases: EvalCaseFixture[];
  adversarialCases: EvalCaseFixture[];
  replica: ReplicaFixture;
}

/** Everything gen:synthetic writes, as in-memory values. Pure and deterministic in (seed, anchor). */
export function buildBundle(seed: number = DEFAULT_SEED, anchor: string = DEMO_ANCHOR_DATE): SyntheticBundle {
  const dataset = generateSynthetic(seed, anchor);
  return {
    dataset,
    ledgerCsv: ledgerToCsv(dataset.ledger),
    clearsCsv: clearsToCsv(dataset.clears),
    generatedCases: sampleGeneratedCases(dataset.ledger, dataset.clears, anchor, seed),
    adversarialCases: buildAdversarialCases(),
    replica: generateReplicaFixture(seed),
  };
}

export const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";
