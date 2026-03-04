import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
