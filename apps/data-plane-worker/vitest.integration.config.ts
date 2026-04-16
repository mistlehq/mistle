import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.test.ts"],
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
