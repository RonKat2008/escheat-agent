/**
 * The Vault's shader colors: the DESIGN-V3 §1.2 OKLCH tokens converted to sRGB floats (0..1), because GLSL cannot
 * read CSS variables. Black, electric blue and pink only. Keep in sync with globals.css @theme.
 */
type RGB = readonly [number, number, number];

export const VAULT_RGB = {
  ink0: [0, 0, 0],
  ink2: [0.051, 0.059, 0.079],
  ink3: [0.082, 0.094, 0.128],
  ink4: [0.114, 0.129, 0.188],
  fg3: [0.502, 0.538, 0.627],
  blue950: [0.023, 0.051, 0.141],
  blue900: [0.038, 0.083, 0.208],
  blue800: [0.067, 0.137, 0.419],
  blue500: [0.242, 0.482, 1.0],
  blue400: [0.427, 0.609, 0.999],
  blue300: [0.616, 0.733, 1.0],
  blue200: [0.79, 0.847, 1.0],
  pink600: [0.88, 0.12, 0.521],
  pink500: [0.999, 0.303, 0.651],
  pink400: [1.0, 0.498, 0.755],
} as const satisfies Record<string, RGB>;
