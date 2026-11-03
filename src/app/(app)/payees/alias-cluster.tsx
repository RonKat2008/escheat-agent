import { InstrumentLabel } from "@/components/primitives";
import { SrTable } from "@/components/viz/core/SrTable";
import { VIZ } from "@/components/viz/core/palette";
import { layoutCluster, type ClusterInput } from "./cluster-model";

const BASIS_LABEL = { exact: "exact", rule: "rule", model: "model", human: "human" } as const;

function clip(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Alias cluster (§6.5 hero): the canonical name with its raw ledger variants around it, each edge labelled with how the
 * merge was decided. A model merge stays pink until a person confirms it. Accessible twin: a visually hidden table.
 */
export function AliasCluster(props: ClusterInput) {
  const l = layoutCluster(props);
  const cx = l.width / 2;
  const cy = l.height / 2;
  return (
    <figure className="m-0" data-testid="alias-cluster">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <InstrumentLabel>Name variants</InstrumentLabel>
        {l.spokes.some((s) => s.pending) ? <span className="text-xs text-pink-400">Model merge, not yet confirmed by a person</span> : null}
      </figcaption>
      {l.spokes.length === 0 ? (
        <p className="text-[13px] text-fg-3">Every ledger line uses the canonical name. Nothing was merged.</p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-ink-0" tabIndex={0} role="region" aria-label="Name variants diagram, scrolls on narrow screens">
          <svg viewBox={`0 0 ${l.width} ${l.height}`} width="100%" style={{ minWidth: 420, display: "block" }} aria-hidden>
            {l.spokes.map((s) => {
              const stroke = s.pending ? VIZ.pink500 : VIZ.blue500;
              const mx = (cx + s.x) / 2;
              const my = (cy + s.y) / 2;
              return (
                <g key={s.name} data-basis={s.basis}>
                  <line x1={cx} y1={cy} x2={s.x} y2={s.y} stroke={stroke} strokeWidth={1.5} strokeDasharray={s.pending ? "4 3" : undefined} />
                  <rect x={mx - 20} y={my - 8} width={40} height={16} rx={3} fill={VIZ.ink0} stroke={VIZ.lineStrong} />
                  <text x={mx} y={my + 4} textAnchor="middle" className={s.pending ? "fill-pink-400 font-mono" : "fill-fg-2 font-mono"} fontSize={9.5} letterSpacing="0.06em">
                    {BASIS_LABEL[s.basis].toUpperCase()}
                  </text>
                  <circle cx={s.x} cy={s.y} r={4} fill={s.pending ? VIZ.pink500 : VIZ.blue500} />
                  <text x={s.x + (s.anchor === "start" ? 9 : s.anchor === "end" ? -9 : 0)} y={s.anchor === "middle" ? (s.y < cy ? s.y - 10 : s.y + 18) : s.y + 4} textAnchor={s.anchor} className="fill-fg-1" fontSize={12}>
                    {clip(s.name)}
                  </text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={6} fill={VIZ.ink0} stroke={VIZ.blue400} strokeWidth={2} />
            <text x={cx} y={cy + 22} textAnchor="middle" className="fill-fg-1" fontSize={12.5} fontWeight={600}>
              {clip(l.center.name, 28)}
            </text>
          </svg>
        </div>
      )}
      {l.hidden > 0 ? <p className="mt-1 text-xs text-fg-3">{l.hidden} more variants are listed under Aliases.</p> : null}
      <SrTable
        caption={`Name variants merged into ${l.center.name}`}
        columns={["Variant", "Ledger lines", "Merge basis", "Confirmed by a person"]}
        rows={l.spokes.map((s) => [s.name, String(s.lines), BASIS_LABEL[s.basis], s.pending ? "No" : "Yes or not needed"])}
      />
    </figure>
  );
}
