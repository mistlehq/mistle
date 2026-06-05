import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
  },
  test: {
    include: ["integration/**/*.integration.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    teardownTimeout: 240_000,
  },
});
