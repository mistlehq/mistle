import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.stress.test.ts"],
    fileParallelism: true,
    testTimeout: 60_000,
  },
});
