/**
 * Minimal STORE-only ZIP writer (no compression, no dependency): local file headers, file data, central directory and
 * the end-of-central-directory record. Deterministic: entries keep the given order and every timestamp is the fixed
 * DOS epoch, so the same files always give the same bytes. Names are UTF-8 (flag bit 11). Pure.
 */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00 in DOS date/time. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UTF8_FLAG = 0x0800;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_U16) throw new RangeError("zipStore: too many entries");
  if (new Set(entries.map((e) => e.name)).size !== entries.length) throw new Error("zipStore: duplicate entry name");
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const crcs = entries.map((e) => crc32(e.data));
  const localSize = entries.reduce((n, e, i) => n + 30 + names[i]!.length + e.data.length, 0);
  const centralSize = entries.reduce((n, _e, i) => n + 46 + names[i]!.length, 0);
  const total = localSize + centralSize + 22;
  if (total > MAX_U32) throw new RangeError("zipStore: archive over 4 GiB (ZIP64 not supported)");

  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  entries.forEach((e, i) => {
    offsets.push(p);
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, UTF8_FLAG, true);
    v.setUint16(p + 8, 0, true); // method 0 = stored
    v.setUint16(p + 10, DOS_TIME, true);
    v.setUint16(p + 12, DOS_DATE, true);
    v.setUint32(p + 14, crcs[i]!, true);
    v.setUint32(p + 18, e.data.length, true);
    v.setUint32(p + 22, e.data.length, true);
    v.setUint16(p + 26, names[i]!.length, true);
    v.setUint16(p + 28, 0, true);
    out.set(names[i]!, p + 30);
    out.set(e.data, p + 30 + names[i]!.length);
    p += 30 + names[i]!.length + e.data.length;
  });
  const centralStart = p;
  entries.forEach((e, i) => {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 20, true);
    v.setUint16(p + 8, UTF8_FLAG, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, DOS_TIME, true);
    v.setUint16(p + 14, DOS_DATE, true);
    v.setUint32(p + 16, crcs[i]!, true);
    v.setUint32(p + 20, e.data.length, true);
    v.setUint32(p + 24, e.data.length, true);
    v.setUint16(p + 28, names[i]!.length, true);
    // extra, comment, disk, internal/external attributes stay 0
    v.setUint32(p + 42, offsets[i]!, true);
    out.set(names[i]!, p + 46);
    p += 46 + names[i]!.length;
  });
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, centralSize, true);
  v.setUint32(p + 16, centralStart, true);
  return out;
}

/** Entry names and sizes from a ZIP's central directory (for tests and download checks). */
export function listZip(zip: Uint8Array): { name: string; size: number; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; size: number; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)),
      size: v.getUint32(p + 24, true),
      crc: v.getUint32(p + 16, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
