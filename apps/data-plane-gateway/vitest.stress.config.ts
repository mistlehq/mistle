import { defineConfig, mergeConfig } from "vitest/config";

import integrationConfig from "./vitest.integration.config.js";

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      include: ["integration/**/*.stress.test.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 300_000,
      hookTimeout: 300_000,
      teardownTimeout: 300_000,
    },
  }),
);
