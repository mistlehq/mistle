import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    teardownTimeout: 240_000,
  },
});
