/**
 * Tiny module store between the scroll-linked steps (writer), the OGL scene (reads the camera target each frame) and
 * the DOM label overlay (follows the camera the scene actually rendered). No React state: updates run per frame.
 */
import type { CameraKey } from "./scene-math";

let target = 0;
let current: CameraKey | null = null;
const listeners = new Set<(cam: CameraKey) => void>();

export function setVaultCameraTarget(p: number): void {
  target = p;
}

export function getVaultCameraTarget(): number {
  return target;
}

export function publishVaultCamera(cam: CameraKey): void {
  current = cam;
  listeners.forEach((fn) => fn(cam));
}

export function subscribeVaultCamera(fn: (cam: CameraKey) => void): () => void {
  listeners.add(fn);
  if (current) fn(current);
  return () => {
    listeners.delete(fn);
  };
}

/** Called when the live scene unmounts so labels fall back to the poster's rest frame. */
export function resetVaultCamera(): void {
  current = null;
}
