import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      ws: require.resolve("ws"),
    },
    tsconfigPaths: true,
  },
  test: {
    include: ["integration/**/*.integration.test.ts", "integration/**/*.integration.test.tsx"],
    setupFiles: ["./integration/setup-vitest.ts"],
  },
});
