import { describe, expect, it } from "vitest";
import { selectedGroups } from "./select-groups";

const ALL = ["demo", "agents", "ui", "a11y"] as const;
const cli = (...args: string[]) => ["node", "playwright", "test", ...args];

describe("selectedGroups", () => {
  it("boots only the ui server for --project ui", () => {
    expect(selectedGroups(cli("ui-v3-perf", "--project", "ui"), undefined, ALL)).toEqual(["ui"]);
    expect(selectedGroups(cli("--project=ui"), undefined, ALL)).toEqual(["ui"]);
  });

  it("supports several projects, repeated or comma-separated, in config order", () => {
    expect(selectedGroups(cli("--project", "a11y", "--project", "ui"), undefined, ALL)).toEqual(["ui", "a11y"]);
    expect(selectedGroups(cli("--project=demo,agents"), undefined, ALL)).toEqual(["demo", "agents"]);
  });

  it("falls back to E2E_PROJECTS, and the CLI wins over it", () => {
    expect(selectedGroups(cli(), "ui, a11y", ALL)).toEqual(["ui", "a11y"]);
    expect(selectedGroups(cli("--project", "demo"), "ui", ALL)).toEqual(["demo"]);
  });

  it("starts every server when nothing (or something unknown) is selected", () => {
    expect(selectedGroups(cli(), undefined, ALL)).toEqual([...ALL]);
    expect(selectedGroups(cli(), "", ALL)).toEqual([...ALL]);
    expect(selectedGroups(cli("--project", "u*"), undefined, ALL)).toEqual([...ALL]);
    expect(selectedGroups(cli("--project", "ui", "--project", "perf"), undefined, ALL)).toEqual([...ALL]);
  });
});
