import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, listZip, zipStore } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipStore", () => {
  const entries = [
    { name: "a.csv", data: bytes("x,y\r\n1,2\r\n") },
    { name: "dir/é.txt", data: bytes("héllo") },
    { name: "empty.bin", data: new Uint8Array() },
  ];

  it("lists its own central directory", () => {
    expect(listZip(zipStore(entries)).map((e) => [e.name, e.size])).toEqual([
      ["a.csv", 10],
      ["dir/é.txt", 6],
      ["empty.bin", 0],
    ]);
  });

  it("is deterministic and rejects duplicate names", () => {
    expect(zipStore(entries)).toEqual(zipStore(entries));
    expect(() => zipStore([entries[0]!, entries[0]!])).toThrow(/duplicate/);
  });

  it("round-trips with unzip -l and unzip -t, and extracts identical bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const path = join(dir, "t.zip");
    writeFileSync(path, zipStore(entries));
    const listing = execFileSync("unzip", ["-l", path], { encoding: "utf8" });
    expect(listing).toContain("a.csv");
    expect(listing).toContain("empty.bin");
    expect(listing).toMatch(/3 files/);
    expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", path, "a.csv"])).toEqual(Buffer.from(entries[0]!.data));
  });
});
