import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayHost, isTrustedSourceHost, RULE_SOURCE_HOSTS } from "./link-hosts";

function urlsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && /^https?:\/\//.test(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => urlsIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => urlsIn(v, out));
  return out;
}

describe("rule-source link allowlist", () => {
  it("covers every host cited by the rule files", () => {
    const dir = path.join(process.cwd(), "rules");
    const hosts = new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => urlsIn(JSON.parse(readFileSync(path.join(dir, f), "utf8"))))
        .map((u) => displayHost(new URL(u).hostname)),
    );
    expect(hosts.size).toBeGreaterThan(3);
    for (const h of hosts) expect(RULE_SOURCE_HOSTS).toContain(h);
  });

  it("matches hosts exactly, ignoring case and www", () => {
    expect(isTrustedSourceHost("WWW.sco.ca.gov")).toBe(true);
    expect(isTrustedSourceHost("sco.ca.gov.evil.example")).toBe(false);
    expect(isTrustedSourceHost("evilsco.ca.gov")).toBe(false);
  });
});
