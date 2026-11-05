import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/crypto";
import { chainHash, chainHashInput, GENESIS_HASH, nextChainRow, shortHash, verifyRows, type ChainRow } from "./chain";

const T0 = Date.parse("2026-11-01T12:00:00.000Z");

function build(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      nextChainRow(rows.at(-1) ?? null, {
        kind: i % 2 ? "approval.granted" : "clock.move",
        subjectType: "thing",
        subjectId: `id-${i}`,
        occurredAt: new Date(T0 + i * 1000),
        payload: { n: i, nested: { b: 2, a: 1 }, list: [3, 1, 2] },
      }),
    );
  }
  return rows;
}

describe("canonical serialization", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });

  it("hashes the same facts identically regardless of key order", () => {
    const at = new Date(T0);
    const a = nextChainRow(null, { kind: "k", subjectType: "s", subjectId: "1", occurredAt: at, payload: { x: 1, y: 2 } });
    const b = nextChainRow(null, { kind: "k", subjectType: "s", subjectId: "1", occurredAt: at, payload: { y: 2, x: 1 } });
    expect(a.payload).toBe('{"x":1,"y":2}');
    expect(a.hash).toBe(b.hash);
  });

  it("covers seq, prevHash, occurredAt, kind, subject and payload in the hashed string", () => {
    const [row] = build(1);
    expect(JSON.parse(chainHashInput(row!))).toEqual({
      seq: 1,
      prevHash: GENESIS_HASH,
      occurredAt: "2026-11-01T12:00:00.000Z",
      kind: "clock.move",
      subject: { type: "thing", id: "id-0" },
      payload: { list: [3, 1, 2], n: 0, nested: { a: 1, b: 2 } },
    });
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash(row!)).toBe(row!.hash);
  });

  it("changes the hash when any hashed field changes", () => {
    const [row] = build(1);
    const base = row!;
    for (const changed of [
      { ...base, seq: 2 },
      { ...base, prevHash: "f".repeat(64) },
      { ...base, occurredAt: new Date(T0 + 1) },
      { ...base, kind: "clock.reset" },
      { ...base, subjectType: "other" },
      { ...base, subjectId: "id-x" },
      { ...base, payload: '{"n":1}' },
    ]) {
      expect(chainHash(changed)).not.toBe(base.hash);
    }
  });

  it("links each row to the previous hash, starting at genesis", () => {
    const rows = build(3);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBe(GENESIS_HASH);
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);
  });

  it("shortens a hash as head…tail", () => {
    expect(shortHash("3f9a" + "0".repeat(56) + "c21e")).toBe("3f9a…c21e");
  });
});

describe("verifyRows", () => {
  it("verifies an intact chain and reports length and head", () => {
    const rows = build(5);
    expect(verifyRows(rows)).toEqual({ ok: true, length: 5, headHash: rows[4]!.hash });
  });

  it("verifies an empty chain with the genesis head", () => {
    expect(verifyRows([])).toEqual({ ok: true, length: 0, headHash: GENESIS_HASH });
  });

  it("detects a payload edit", () => {
    const rows = build(5);
    rows[2] = { ...rows[2]!, payload: rows[2]!.payload.replace('"n":2', '"n":20') };
    const v = verifyRows(rows);
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(3);
    expect(v.reason).toMatch(/contents do not match/);
  });

  it("detects a payload edit that also recomputes that row's hash (the next row no longer links)", () => {
    const rows = build(5);
    const edited = { ...rows[1]!, payload: '{"n":99}' };
    rows[1] = { ...edited, hash: chainHash(edited) };
    const v = verifyRows(rows);
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(3);
  });

  it("detects a deleted row", () => {
    const rows = build(5);
    rows.splice(1, 1);
    const v = verifyRows(rows);
    expect(v).toMatchObject({ ok: false, length: 4, firstBrokenSeq: 2 });
    expect(v.reason).toMatch(/#2 is missing/);
  });

  it("detects a deleted head row only by length (documented limit), and a deleted first row", () => {
    const rows = build(3);
    expect(verifyRows(rows.slice(1))).toMatchObject({ ok: false, firstBrokenSeq: 1 });
  });

  it("detects reordered rows", () => {
    const rows = build(5);
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    const v = verifyRows(rows);
    expect(v).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it("detects rows whose seq values were swapped to hide a reorder", () => {
    const rows = build(5);
    const a = rows[1]!;
    const b = rows[2]!;
    rows[1] = { ...b, seq: 2 };
    rows[2] = { ...a, seq: 3 };
    const v = verifyRows(rows);
    expect(v).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it("detects a prev_hash edit", () => {
    const rows = build(5);
    rows[3] = { ...rows[3]!, prevHash: "a".repeat(64) };
    const v = verifyRows(rows);
    expect(v).toMatchObject({ ok: false, firstBrokenSeq: 4 });
    expect(v.reason).toMatch(/does not point at the hash of row #3/);
  });

  it("detects an unparseable payload as a content mismatch", () => {
    const rows = build(2);
    rows[0] = { ...rows[0]!, payload: "{not json" };
    expect(verifyRows(rows)).toMatchObject({ ok: false, firstBrokenSeq: 1 });
  });
});
