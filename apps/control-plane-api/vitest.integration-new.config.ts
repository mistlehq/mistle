import { defineConfig } from "vitest/config";

import { WorkspaceAliases } from "./vitest.integration.config.js";

export default defineConfig({
  resolve: {
    alias: WorkspaceAliases,
  },
  test: {
    include: ["integration-new/**/*.integration.test.ts"],
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
