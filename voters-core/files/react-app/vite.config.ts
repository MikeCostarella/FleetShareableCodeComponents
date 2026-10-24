import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages project site: base MUST equal "/<RepoName>/".
const BASE = "/{{REPO}}/";

// https://vitejs.dev/config/
export default defineConfig({
  base: BASE,
  define: {
    // Re-evaluated on every `vite build`, so the live site shows deploy time.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "{{COUNTY}} County Ohio Voters — Voter History",
        short_name: "{{COUNTY}} Voters",
        description:
          "Searchable voter history for {{COUNTY}} County, Ohio - who voted in each recent election, on a map and in a sortable list.",
        theme_color: "#1a2a3a",
        background_color: "#1a2a3a",
        display: "standalone",
        orientation: "any",
        scope: BASE,
        start_url: BASE,
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // geojson is listed explicitly: a data file whose extension is missing
        // here is skipped silently, with no warning and no build failure.
        globPatterns: ["**/*.{js,css,html,png,svg,json,geojson}"],
        runtimeCaching: [
          {
            // Ohio OSIP aerial tiles (vendor/basemaps), cached so the aerial
            // keeps working offline once an area has been viewed.
            urlPattern: ({ url }) => /^https:\/\/maps\.ohio\.gov\/.*\/osip_most_current_cache\//.test(String(url)),
            handler: "CacheFirst",
            options: {
              cacheName: "osip-tiles",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // CARTO label tiles drawn over the aerial (hybrid).
            urlPattern: ({ url }) => /basemaps\.cartocdn\.com/.test(String(url)),
            handler: "CacheFirst",
            options: {
              cacheName: "carto-tiles",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        /**
         * voters.json grows with every election merged in: 2.3 MB at one
         * election, 4.4 MB at four, 9.2 MB at eleven once the 2022, 2023 and
         * 2024 elections landed. Over the wire it is far smaller - GitHub Pages
         * gzips it to about 2.9 MB - but this limit is measured uncompressed,
         * so it
         * has to stay ahead of the file on disk.
         *
         * Exceeding it fails the build outright ("error during build", exit 1),
         * which is the good outcome: raise the number and rebuild. The quieter
         * hazard is globPatterns, not this - see scripts/check-precache.mjs.
         */
        maximumFileSizeToCacheInBytes: 24 * 1024 * 1024,
      },
    }),
  ],
});
