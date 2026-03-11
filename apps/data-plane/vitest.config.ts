import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const AppRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: ["import", "module", "default"],
    alias: {
      "@mistle/gateway-tunnel-auth": resolve(
        AppRoot,
        "../../packages/gateway-tunnel-auth/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.property.test.ts"],
  },
});
