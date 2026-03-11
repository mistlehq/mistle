import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@control-plane/workflows": fileURLToPath(new URL("./workflows/index.ts", import.meta.url)),
      "@control-plane/workflows/runtime": fileURLToPath(
        new URL("./workflows/runtime/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["integration-worker/**/*.integration.test.ts"],
    globalSetup: "./integration-worker/global-setup.ts",
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
