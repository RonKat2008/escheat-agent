/**
 * Which e2e dev servers playwright.config.ts should boot. Each `next dev` server costs about 750 MB of .next-e2e-*
 * cache and a full CPU, so `--project ui` should start only the ui server, not all four.
 * Selection: `--project <name>` / `--project=<name>` (repeatable, comma lists allowed) on the command line, else the
 * E2E_PROJECTS env var (e.g. "ui,a11y"). With neither, or with any name that is not a server group (a glob, a typo),
 * every group starts, so a plain `playwright test` and CI behave exactly as before.
 */
export function selectedGroups<G extends string>(argv: readonly string[], envList: string | undefined, all: readonly G[]): G[] {
  const names: string[] = [];
  argv.forEach((arg, i) => {
    const next = argv[i + 1];
    if (arg === "--project" && next) names.push(next);
    else if (arg.startsWith("--project=")) names.push(arg.slice("--project=".length));
  });
  if (names.length === 0 && envList) names.push(envList);
  const picked = names
    .flatMap((n) => n.split(","))
    .map((n) => n.trim())
    .filter(Boolean);
  if (picked.length === 0 || picked.some((n) => !(all as readonly string[]).includes(n))) return [...all];
  return all.filter((g) => picked.includes(g));
}
