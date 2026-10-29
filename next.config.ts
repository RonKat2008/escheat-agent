import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets concurrent dev servers (one per lane) use separate build dirs.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // Lets a second dev server run in this directory (Next allows one per distDir), e.g. the agent e2e.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite locates its WASM/data files via import.meta.url; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite", "playwright", "playwright-core", "@browserbasehq/stagehand"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
