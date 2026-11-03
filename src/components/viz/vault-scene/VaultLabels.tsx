"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { placeLabels, restFrame, VAULT_ASPECT } from "./labels";
import { subscribeVaultCamera } from "./vault-store";

const EPS = 0.0005;
// Deterministic and pure: computed once per module, identical on server and client.
const { labels, rest } = restFrame();
const initial = placeLabels(labels, rest, VAULT_ASPECT);

/**
 * DOM labels over the poster and the canvas. They render at the rest frame on the server (so the poster is labelled
 * without JS) and follow the live camera via CSS variables (transform only, no layout).
 */
export function VaultLabels() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>("[data-label]").forEach((el) => els.set(el.dataset.label!, el));
    const last = new Map(initial.map((p) => [p.id, p]));
    return subscribeVaultCamera((cam) => {
      const aspect = root.clientWidth / Math.max(1, root.clientHeight) || VAULT_ASPECT;
      for (const p of placeLabels(labels, cam, aspect)) {
        const prev = last.get(p.id);
        if (prev && prev.visible === p.visible && Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) continue;
        last.set(p.id, p);
        const el = els.get(p.id);
        if (!el) continue;
        el.style.setProperty("--x", p.x.toFixed(4));
        el.style.setProperty("--y", p.y.toFixed(4));
        el.dataset.visible = String(p.visible);
      }
    });
  }, []);

  return (
    <div ref={rootRef} className="vault-labels" aria-hidden="true">
      {labels.map((l) => {
        const p = initial.find((q) => q.id === l.id)!;
        return (
          <div
            key={l.id}
            data-label={l.id}
            data-kind={l.kind}
            data-visible={p.visible}
            data-wide-only={l.wideOnly ? "true" : undefined}
            className="vault-label"
            style={{ "--x": p.x.toFixed(4), "--y": p.y.toFixed(4) } as CSSProperties}
          >
            <span className="vault-label-dot" />
            <span className="vault-label-text">
              <strong>{l.text}</strong>
              <span>{l.sub}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
