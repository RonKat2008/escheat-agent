interface GlowFilterProps {
  id?: string;
  /** Blur radius; spec default 3. */
  stdDeviation?: number;
}

/** Shared SVG glow filter. Define once per diagram root; apply only to moving heads. */
export function GlowFilter({ id = "es-glow", stdDeviation = 3 }: GlowFilterProps) {
  return (
    <defs>
      <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation={stdDeviation} result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
