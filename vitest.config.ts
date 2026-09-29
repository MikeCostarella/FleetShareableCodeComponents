// Runs the library's own test suites outside any county app.
//
// The src half reads its county constants from "../../../config/county" - the
// one seam into the app (see parcels-core/src/README.md). In a county repo that
// resolves to react-app/src/config/county.ts. Here there is no app, so the
// alias below points every such import at test-harness/county.ts, a copy of
// Franklin's config: the suites were written and last passed against Franklin,
// so they run against the same values here. This alias exists ONLY in this
// repo; the fleet apps deliberately have no path aliases.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const harness = fileURLToPath(new URL("./test-harness/county.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.\.\/)+config\/county$/, replacement: harness }],
  },
  test: {
    include: ["parcels-core/**/*.test.{ts,mjs}", "address-lookup/**/*.test.{ts,mjs}", "basemaps/**/*.test.{ts,mjs}"],
  },
});
