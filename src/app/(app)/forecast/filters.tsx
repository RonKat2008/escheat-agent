"use client";

import { useQueryStates } from "nuqs";
import { HORIZON_OPTIONS } from "@/lib/forecast/compute";
import { cn } from "@/lib/utils";
import { useForecastUi } from "./interactions";
import { BASIS_VALUES, FORECAST_STATES, forecastParsers, type Basis } from "./params";

interface Option<V> {
  value: V;
  label: string;
}

/** Single-choice segmented control: pressed = ink-3 fill + text-1, the rest stay quiet. */
function Segmented<V extends string | number | null>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly Option<V>[];
  value: V;
  onChange: (v: V) => void;
  testId: string;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex h-8 items-center rounded-md border border-line bg-ink-1 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-full rounded-[5px] px-2.5 text-[13px] whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
              on ? "bg-ink-3 text-fg-1 shadow-[inset_0_0_0_1px_var(--color-line-hover)]" : "text-fg-3 hover:bg-ink-2 hover:text-fg-1",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const STATE_OPTIONS: Option<(typeof FORECAST_STATES)[number] | null>[] = [{ value: null, label: "All states" }, ...FORECAST_STATES.map((s) => ({ value: s, label: s }))];
const HORIZON_OPTS: Option<(typeof HORIZON_OPTIONS)[number]>[] = HORIZON_OPTIONS.map((h) => ({ value: h, label: `${h} mo` }));
const BASIS_LABEL: Record<Basis, string> = { presumed: "Becoming abandoned", remit: "Due to remit" };
const BASIS_OPTS: Option<Basis>[] = BASIS_VALUES.map((b) => ({ value: b, label: BASIS_LABEL[b] }));

function useForecastParams() {
  const { startTransition } = useForecastUi();
  const [params, setParams] = useQueryStates(forecastParsers, { shallow: false, startTransition, clearOnDefault: true });
  return { params, setParams };
}

/** State + horizon. URL state (nuqs), so a filtered forecast is a shareable link. */
export function ForecastFilters() {
  const { params, setParams } = useForecastParams();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented testId="filter-state" label="Owner state" options={STATE_OPTIONS} value={params.state} onChange={(state) => void setParams({ state })} />
      <Segmented testId="filter-horizon" label="Horizon" options={HORIZON_OPTS} value={params.horizon} onChange={(horizon) => void setParams({ horizon })} />
    </div>
  );
}

export function BasisToggle() {
  const { params, setParams } = useForecastParams();
  return <Segmented testId="filter-basis" label="Chart amounts" options={BASIS_OPTS} value={params.basis} onChange={(basis) => void setParams({ basis })} />;
}
