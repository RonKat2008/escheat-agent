/** Series order from the spec: blue-500, blue-300, then neutral white at decreasing strength. No other hues. */
const SERIES = ["var(--chat-blue-500)", "var(--chat-blue-300)", "rgb(255 255 255 / 0.55)", "rgb(255 255 255 / 0.32)", "rgb(255 255 255 / 0.2)"];
export const tint = (i: number) => SERIES[i] ?? "rgb(255 255 255 / 0.14)";

const SIZE = 104;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2 - 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

interface RingSlice {
  state: string;
  cents: number;
}

/**
 * Share-of-total ring as plain SVG strokes. Static on purpose: it paints on the first render (also on the server),
 * has no entry animation to be caught half-drawn, and so needs no reduced-motion branch.
 * (A recharts Pie here painted no sectors for ~500ms and ignored prefers-reduced-motion.)
 */
export function ExposureRing({ slices }: { slices: readonly RingSlice[] }) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.cents), 0);
  const spans = slices.map((s) => (total > 0 ? (Math.max(0, s.cents) / total) * CIRCUMFERENCE : 0));
  const arcs = slices.map((s, i) => ({
    state: s.state,
    length: slices.length > 1 ? Math.max(0, (spans[i] ?? 0) - GAP) : (spans[i] ?? 0),
    offset: -spans.slice(0, i).reduce((sum, v) => sum + v, 0),
    color: tint(i),
  }));
  return (
    <svg data-testid="exposure-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block" role="presentation">
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} fill="none" strokeWidth={STROKE}>
        {arcs.map((a) => (
          <circle key={a.state} data-state={a.state} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={a.color} strokeDasharray={`${a.length} ${CIRCUMFERENCE}`} strokeDashoffset={a.offset} />
        ))}
      </g>
    </svg>
  );
}
