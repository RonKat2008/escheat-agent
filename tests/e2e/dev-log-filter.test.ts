import { describe, expect, it } from "vitest";
import { CONDENSED_LINE, createDevLogFilter } from "./dev-log-filter";

function run(lines: string[]): string[] {
  const out: string[] = [];
  const f = createDevLogFilter((l) => out.push(l));
  lines.forEach((l) => f.line(l));
  f.end();
  return out;
}

const expected404 = [
  "Error: Route \"/replica/[portal]\": Could not validate `instant` because the target segment was prevented from rendering",
  "    at ignore-listed frames",
  "Error: An error occurred while attempting to validate instant UI.",
  "    at ReplicaLayout (src/app/replica/layout.tsx:23:59)",
  "> 23 |   <Link />",
  "  [cause]: Error: NEXT_HTTP_ERROR_FALLBACK;404",
  "    digest: 'NEXT_HTTP_ERROR_FALLBACK;404'",
  "  }",
  "}",
];

describe("dev log filter", () => {
  it("collapses the expected replica 404 instant-validation block to one line", () => {
    expect(run([" GET /a 200", ...expected404, " GET /b 404"])).toEqual([" GET /a 200", CONDENSED_LINE, " GET /b 404"]);
  });
  it("keeps a validation error that is not the handled 404", () => {
    const real = [
      "Error: An error occurred while attempting to validate instant UI.",
      "    at Page (src/app/x.tsx:1:1)",
      "  [cause]: Error: boom",
      "}",
    ];
    expect(run(real)).toEqual(real);
  });
  it("passes unrelated errors and flushes an unfinished block at end", () => {
    expect(run(["Error: database exploded", "    at x"])).toEqual(["Error: database exploded", "    at x"]);
    expect(run(["Error: An error occurred while attempting to validate instant UI.", "    at y"])).toEqual([
      "Error: An error occurred while attempting to validate instant UI.",
      "    at y",
    ]);
  });
});
