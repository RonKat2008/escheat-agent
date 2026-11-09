import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets concurrent dev servers (one per lane) use separate build dirs.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // Keep demo recordings and screenshots free of the dev overlay badge.
  devIndicators: false,
  // PGlite locates its WASM/data files via import.meta.url; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite", "playwright", "playwright-core", "@browserbasehq/stagehand"],
  partialPrefetching: true,
  // ASK-MODE §1.3: Chat became Ask. The query (?q= sends, ?ask= prefills) carries over to the destination.
  async redirects() {
    return [{ source: "/chat", destination: "/ask", permanent: true }];
  },
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
