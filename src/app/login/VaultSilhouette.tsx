import { US_NATION_PATH, US_STATE_BORDERS_PATH, US_VIEWBOX } from "./us-outline";

/**
 * Login left panel art (DESIGN-V3 §6.2): the Money Map as a static outline on the vault floor. Shape only: no states
 * highlighted, no columns, no numbers, because the login screen has no company data to show. Tilted like the dashboard
 * plane; flattened to 2D under reduced motion (§2.3 static tier). Decorative, so hidden from assistive tech.
 */
export function VaultSilhouette() {
  return (
    <div aria-hidden className="pointer-events-none relative w-full [perspective:1400px]" data-testid="vault-silhouette">
      <div className="vault-floor absolute inset-[-20%]" />
      <svg
        viewBox={US_VIEWBOX}
        className="relative block h-auto w-full [transform:rotateX(48deg)_rotateZ(-8deg)] [transform-origin:50%_60%] motion-reduce:[transform:none] [html[data-motion=reduce]_&]:[transform:none]"
        fill="none"
      >
        <path d={US_STATE_BORDERS_PATH} className="stroke-fg-4" strokeWidth={0.75} strokeOpacity={0.55} vectorEffect="non-scaling-stroke" />
        <path d={US_NATION_PATH} className="stroke-line-strong" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
