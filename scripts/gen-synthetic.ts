/** Writes the SYNTHETIC demo fixtures. Usage: pnpm gen:synthetic [-- --seed N] */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBundle, json } from "../src/lib/synthetic/build";
import { DEFAULT_SEED, DEMO_ANCHOR_DATE } from "../src/lib/synthetic/model";
import { computeDemoStats } from "../src/lib/synthetic/labels";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = Number(arg("seed") ?? DEFAULT_SEED);
const anchor = arg("anchor") ?? process.env.DEMO_ANCHOR_DATE?.trim() ?? DEMO_ANCHOR_DATE;
if (!Number.isInteger(seed)) throw new Error(`invalid --seed: ${arg("seed")}`);

const root = process.cwd();
const write = (rel: string, content: string) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${rel}`);
};

const bundle = buildBundle(seed, anchor);
write("fixtures/synthetic/ledger.csv", bundle.ledgerCsv);
write("fixtures/synthetic/bank_clears.csv", bundle.clearsCsv);
write("fixtures/replica/search-records.json", json(bundle.replica));
write("fixtures/eval/cases.generated.json", json(bundle.generatedCases));
write("fixtures/eval/cases.adversarial.json", json(bundle.adversarialCases));

const stats = computeDemoStats(bundle.dataset.ledger, bundle.dataset.clears, anchor);
console.log(
  `seed=${seed} anchor=${anchor} ledger=${bundle.dataset.ledger.length} clears=${bundle.dataset.clears.length} ` +
    `stale=${stats.staleCount} total_cents=${stats.staleTotalCents} owners=${JSON.stringify(stats.byOwnerState)}`,
);
