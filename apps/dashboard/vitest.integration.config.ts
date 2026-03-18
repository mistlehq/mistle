import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["integration/**/*.integration.test.ts", "integration/**/*.integration.test.tsx"],
  },
});
