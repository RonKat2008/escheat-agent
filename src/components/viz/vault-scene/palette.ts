/**
 * The Vault's shader colors: the V4 "Tidewell glass" hex tokens converted to sRGB floats (0..1), because GLSL cannot
 * read CSS variables. Navy, steel blue and coral only. Keep in sync with globals.css @theme.
 * The fog target in shaders.ts is ink0 (vec3(0.043, 0.078, 0.188)); change both together.
 */
type RGB = readonly [number, number, number];

export const VAULT_RGB = {
  ink0: [0.043, 0.078, 0.188], // #0B1430
  ink2: [0.078, 0.129, 0.239], // #14213D
  ink3: [0.11, 0.169, 0.302], // #1C2B4D
  ink4: [0.149, 0.216, 0.361], // #26375C
  fg3: [0.651, 0.675, 0.745], // #A6ACBE
  blue950: [0.09, 0.141, 0.251], // #172440
  blue900: [0.122, 0.18, 0.322], // #1F2E52
  blue800: [0.173, 0.247, 0.42], // #2C3F6B
  blue500: [0.498, 0.604, 0.816], // #7F9AD0
  blue400: [0.616, 0.706, 0.878], // #9DB4E0
  blue300: [0.741, 0.808, 0.933], // #BDCEEE
  blue200: [0.863, 0.902, 0.969], // #DCE6F7
  pink600: [0.91, 0.314, 0.247], // #E8503F
  pink500: [1.0, 0.42, 0.357], // #FF6B5B
  pink400: [1.0, 0.557, 0.502], // #FF8E80
} as const satisfies Record<string, RGB>;
