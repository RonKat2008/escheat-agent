/**
 * Renders The Vault's static poster from the live scene code (DESIGN-V3 §3.1): bundles
 * src/components/viz/vault-scene/vault-renderer.ts, draws the rest frame at 1600x1000 in headless Chromium (WebGL via
 * SwiftShader), and writes public/marketing/vault-poster.webp (browser-encoded) and vault-poster.avif (sharp).
 *
 * Usage: pnpm exec tsx scripts/render-vault-poster.ts [--time 3.0] [--camera 0..4 --preview out.webp]
 * The default time catches the cycle while the light is held at the pink gates, so the poster shows the human step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/marketing");
const WIDTH = 1600;
const HEIGHT = 1000;
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TIME = Number(arg("--time") ?? 3.0);
/** Camera keyframe to render (0 = rest frame, the poster). Other values are for checking the step keyframes. */
const CAMERA = Number(arg("--camera") ?? 0);
/** Write a single preview .webp here instead of the poster files. */
const PREVIEW = arg("--preview");

// esbuild and sharp are transitive dependencies (of tsx and next); resolve them from their owners.
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
const requireFromTsx = createRequire(requireFromRoot.resolve("tsx/package.json"));
const requireFromNext = createRequire(requireFromRoot.resolve("next/package.json"));

interface EsbuildLike {
  build(opts: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
}
type SharpLike = (input: Buffer) => { avif(o: { quality: number; effort: number }): { toBuffer(): Promise<Buffer> } };

async function bundle(): Promise<string> {
  const esbuild = requireFromTsx("esbuild") as EsbuildLike;
  const result = await esbuild.build({
    stdin: {
      contents: `import { createVaultRenderer } from "./vault-renderer"; (window as any).createVaultRenderer = createVaultRenderer;`,
      resolveDir: path.join(ROOT, "src/components/viz/vault-scene"),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    minify: true,
    nodePaths: [path.join(ROOT, "node_modules")],
  });
  return result.outputFiles[0]!.text;
}

async function main() {
  const code = await bundle();
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:black"><canvas id="c" style="width:${WIDTH}px;height:${HEIGHT}px;display:block"></canvas></body></html>`,
    );
    await page.addScriptTag({ content: code });
    const webp = await page.evaluate(
      ({ w, h, t, cam }) => {
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        type Api = {
          resize(w: number, h: number): void;
          snapCamera(p: number): void;
          frame(t: number, target: number, dt: number): unknown;
        };
        const create = (window as unknown as { createVaultRenderer: (o: object) => Api }).createVaultRenderer;
        const vault = create({ canvas, dpr: 1, particles: 600, preserveDrawingBuffer: true });
        vault.resize(w, h);
        vault.snapCamera(cam);
        vault.frame(t, cam, 0);
        return canvas.toDataURL("image/webp", 0.82);
      },
      { w: WIDTH, h: HEIGHT, t: TIME, cam: CAMERA },
    );
    const buf = Buffer.from(webp.split(",")[1]!, "base64");
    if (PREVIEW) {
      writeFileSync(PREVIEW, buf);
      console.log(`preview ${PREVIEW} (camera ${CAMERA}, t=${TIME}s)`);
      return;
    }
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, "vault-poster.webp"), buf);
    const sharp = requireFromNext("sharp") as SharpLike;
    const avif = await sharp(buf).avif({ quality: 52, effort: 6 }).toBuffer();
    writeFileSync(path.join(OUT_DIR, "vault-poster.avif"), avif);
    console.log(`vault-poster.webp ${(buf.length / 1024).toFixed(1)} KB, vault-poster.avif ${(avif.length / 1024).toFixed(1)} KB (t=${TIME}s)`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
