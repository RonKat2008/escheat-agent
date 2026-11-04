/**
 * Which optional tour routes are missing from this build. One HEAD request per optional path, once per page load
 * (cached). Only a 404 counts as missing: a network error, a redirect or any other status keeps the stop, and the
 * runtime anchor check skips it later if there is still nothing to point at. HEAD never changes anything.
 */
let cached: Promise<ReadonlySet<string>> | null = null;

export type Probe = (path: string) => Promise<number>;

const headStatus: Probe = async (path) => {
  const res = await fetch(path, { method: "HEAD", cache: "no-store", redirect: "manual", credentials: "same-origin" });
  return res.status;
};

export async function findMissing(paths: readonly string[], probe: Probe = headStatus): Promise<ReadonlySet<string>> {
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        return (await probe(p)) === 404 ? p : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(results.filter((p): p is string => p !== null));
}

/** Cached for the page's lifetime: routes do not appear or disappear while the tour runs. */
export function missingRoutes(paths: readonly string[]): Promise<ReadonlySet<string>> {
  cached ??= findMissing(paths);
  return cached;
}
