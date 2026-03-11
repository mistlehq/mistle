import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: ["import", "module", "default"],
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
