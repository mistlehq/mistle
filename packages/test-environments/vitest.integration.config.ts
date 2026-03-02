import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["integration/**/*.integration.test.ts"],
  },
});
