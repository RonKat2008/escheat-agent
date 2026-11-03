/**
 * Draw axis of a straight SVG line for DrawLine's CSS draw: "y" for a vertical line (`M x y V y2`), otherwise "x"
 * (horizontal `M x y H x2`, and the safe default for anything else).
 */
export function drawAxis(d: string): "x" | "y" {
  return /[Vv]/.test(d) && !/[Hh]/.test(d) ? "y" : "x";
}
