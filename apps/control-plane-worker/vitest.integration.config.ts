import { defineConfig } from "vitest/config";

import { WorkspaceAliases } from "./vitest.workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: WorkspaceAliases,
  },
  test: {
    include: ["integration/**/*.integration.test.ts"],
    globalSetup: "./integration/global-setup.ts",
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
