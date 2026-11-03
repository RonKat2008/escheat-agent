/** DOM label anchors for The Vault (pure). The same labels sit over the poster and the live canvas. */
import {
  buildThreads,
  cameraKeys,
  gatePosition,
  layoutSlabs,
  project,
  PYLON_HEIGHT,
  PYLON_X,
  PYLON_Z,
  RECOVERED_PAD,
  STALE_BY_STATE,
  type CameraKey,
  type Curve,
  type Vec3,
} from "./scene-math";

export type LabelKind = "state" | "human" | "agent";

export interface VaultLabel {
  id: string;
  text: string;
  sub: string;
  kind: LabelKind;
  point: Vec3;
  /** Hidden on narrow viewports to avoid crowding. */
  wideOnly?: boolean;
}

const STATE_NAME = { CA: "California", TX: "Texas", DE: "Delaware" } as const;

export function vaultLabels(curves: readonly Curve[]): VaultLabel[] {
  const states = (["CA", "TX", "DE"] as const).map(
    (code): VaultLabel => ({
      id: code,
      text: code,
      sub: `${STATE_NAME[code]} · ${STALE_BY_STATE[code]} stale`,
      kind: "state",
      point: [PYLON_X[code], PYLON_HEIGHT + 0.55, PYLON_Z],
    }),
  );
  const g = gatePosition(curves[1]!);
  return [
    ...states,
    { id: "gate", text: "Needs your approval", sub: "The light waits here", kind: "human", point: [g[0] + 2.1, g[1] + 0.2, g[2]] },
    { id: "ledger", text: "Ledger", sub: "733 synthetic rows · 47 stale", kind: "agent", point: [-6.2, 0.4, 4.4], wideOnly: true },
    { id: "recovered", text: "Recovered", sub: "Money owed back to you", kind: "agent", point: [RECOVERED_PAD[0], 0.5, RECOVERED_PAD[2]], wideOnly: true },
  ];
}

export interface PlacedLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

/** Normalized (0..1) positions for every label under a camera at the given aspect. */
export function placeLabels(labels: readonly VaultLabel[], cam: CameraKey, aspect: number): PlacedLabel[] {
  return labels.map((l) => {
    const p = project(l.point, cam, aspect);
    const visible = p !== null && p.x > 0.02 && p.x < 0.98 && p.y > 0.03 && p.y < 0.97;
    return { id: l.id, x: p?.x ?? 0, y: p?.y ?? 0, visible };
  });
}

/** Rest-frame data shared by the server render (poster labels) and the client. */
export function restFrame(): { curves: Curve[]; labels: VaultLabel[]; rest: CameraKey } {
  const curves = buildThreads(layoutSlabs());
  return { curves, labels: vaultLabels(curves), rest: cameraKeys(curves)[0]! };
}

/** The poster and the stage share this aspect so labels line up without cropping. */
export const VAULT_ASPECT = 1.6;
