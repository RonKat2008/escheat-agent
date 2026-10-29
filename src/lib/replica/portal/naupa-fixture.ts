/** Builds small, valid NAUPA II files (625-byte records, CRLF) for tests and e2e. SYNTHETIC data only. */
export interface FixtureProperty {
  owner: string;
  code: string;
  cents: number;
}
export interface FixtureOptions {
  holderName?: string;
  reportType?: "A" | "R" | "T";
  reportYear?: string;
  properties?: FixtureProperty[];
  /** Override SUMINFO property total to produce an invalid file. */
  suminfoCents?: number;
}

const LEN = 625;
function put(line: string[], from: number, to: number, value: string, right = false) {
  const width = to - from + 1;
  const v = (right ? value.padStart(width, "0") : value.padEnd(width, " ")).slice(0, width);
  for (let i = 0; i < width; i++) line[from - 1 + i] = v[i]!;
}
const blank = () => Array.from({ length: LEN }, () => " ");

export const DEFAULT_FIXTURE_PROPERTIES: FixtureProperty[] = [
  { owner: "BAYLINE ELECTRIC", code: "CK13", cents: 234000 },
  { owner: "SYNTH VENDOR TWO", code: "CK13", cents: 15050 },
  { owner: "SYNTH CUSTOMER THREE", code: "MS01", cents: 9900 },
];

export function buildNaupaFile(opts: FixtureOptions = {}): string {
  const props = opts.properties ?? DEFAULT_FIXTURE_PROPERTIES;
  const total = props.reduce((s, p) => s + p.cents, 0);
  const rows: string[] = [];

  const h = blank();
  put(h, 1, 1, "1");
  put(h, 2, 10, "000000001", true);
  put(h, 11, 14, "0001");
  put(h, 15, 18, opts.reportYear ?? "2026");
  put(h, 19, 19, opts.reportType ?? "R");
  put(h, 20, 21, "01");
  put(h, 22, 22, "R");
  put(h, 37, 76, opts.holderName ?? "NORTHWIND FIXTURES INC");
  put(h, 77, 106, "AUSTIN");
  put(h, 127, 128, "TX");
  rows.push(h.join(""));

  props.forEach((p, i) => {
    const r = blank();
    put(r, 1, 1, "2");
    put(r, 2, 7, String(i + 1), true);
    put(r, 8, 8, "P");
    put(r, 9, 9, "C");
    put(r, 10, 49, p.owner);
    put(r, 305, 308, p.code);
    put(r, 309, 318, String(p.cents), true);
    put(r, 331, 340, String(p.cents), true);
    put(r, 601, 602, "PA");
    put(r, 603, 604, "OT");
    rows.push(r.join(""));
  });

  const s = blank();
  put(s, 1, 1, "9");
  put(s, 2, 7, String(props.length + 2), true);
  put(s, 8, 13, String(props.length), true);
  put(s, 14, 25, String(opts.suminfoCents ?? total), true);
  rows.push(s.join(""));
  return rows.join("\r\n") + "\r\n";
}
