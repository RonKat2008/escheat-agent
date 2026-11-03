import { VIZ } from "@/components/viz/core/palette";

const R = 9;
const C = 2 * Math.PI * R;

/** §6.9 hero: verification ring meter. Blue arc = verified share, fg-4 track. Decorative; the label beside it carries the numbers. */
export function VerifyMeter({ verified, total, size = 22 }: { verified: number; total: number; size?: number }) {
  const share = total > 0 ? Math.min(1, Math.max(0, verified / total)) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false" className="shrink-0 -rotate-90" data-testid="verify-meter">
      <circle cx="12" cy="12" r={R} fill="none" stroke={VIZ.fg4} strokeWidth="2.5" />
      {share > 0 ? (
        <circle cx="12" cy="12" r={R} fill="none" stroke={VIZ.blue500} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${share * C} ${C}`} />
      ) : null}
    </svg>
  );
}
