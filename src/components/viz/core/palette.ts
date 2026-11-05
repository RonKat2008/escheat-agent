/**
 * The only place viz colors live. Every value is a CSS variable reference
 * (defined in globals.css `@theme`). No literal colors anywhere else in viz/.
 */
const v = (name: string) => `var(--color-${name})`;

export const VIZ = {
  // semantic roles
  series1: v("blue-500"),
  series2: v("blue-300"),
  series3: v("fg-3"),
  needsYou: v("pink-500"),
  unknown: v("fg-4"),
  grid: v("grid"),
  line: v("line"),
  lineHover: v("line-hover"),
  lineStrong: v("line-strong"),
  text: v("fg-3"),
  textStrong: v("fg-1"),
  textMuted: v("fg-2"),
  // surfaces
  ink0: v("ink-0"),
  ink1: v("ink-1"),
  ink2: v("ink-2"),
  ink3: v("ink-3"),
  ink4: v("ink-4"),
  // foreground
  fg1: v("fg-1"),
  fg2: v("fg-2"),
  fg3: v("fg-3"),
  fg4: v("fg-4"),
  // steel blue ramp
  blue200: v("blue-200"),
  blue300: v("blue-300"),
  blue400: v("blue-400"),
  blue500: v("blue-500"),
  blue600: v("blue-600"),
  blue700: v("blue-700"),
  blue800: v("blue-800"),
  blue900: v("blue-900"),
  blue950: v("blue-950"),
  // coral ramp
  pink300: v("pink-300"),
  pink400: v("pink-400"),
  pink500: v("pink-500"),
  pink600: v("pink-600"),
  pink700: v("pink-700"),
  pink900: v("pink-900"),
  pink950: v("pink-950"),
} as const;

export type VizColor = (typeof VIZ)[keyof typeof VIZ];
