import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { PRECACHE_LIMIT, onlineOnlyFiles } from "./scripts/online-only.mjs";

// GitHub Pages project site: base MUST equal "/<RepoName>/".
const BASE = "/{{REPO}}/";

/**
 * Data files over the precache limit (a big county's voters.json): left out of
 * the install-time precache and cached on first load instead. See
 * scripts/online-only.mjs.
 */
const ONLINE_ONLY = onlineOnlyFiles();

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
        globIgnores: ONLINE_ONLY.map((f) => `**/data/${f}`),
        runtimeCaching: [
          {
            // Online-only data files (see ONLINE_ONLY above): cached on first load.
            urlPattern: ({ url }) => ONLINE_ONLY.some((f) => url.pathname.endsWith(`/data/${f}`)),
            handler: "NetworkFirst",
            options: {
              cacheName: "voters-data",
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
         * A data file over it is now left out on purpose (ONLINE_ONLY above)
         * rather than failing the build. The quieter hazard is globPatterns,
         * not this - see scripts/check-precache.mjs.
         */
        maximumFileSizeToCacheInBytes: PRECACHE_LIMIT,
      },
    }),
  ],
});
