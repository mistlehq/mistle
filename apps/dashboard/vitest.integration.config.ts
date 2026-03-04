import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["integration/**/*.integration.test.ts", "integration/**/*.integration.test.tsx"],
  },
});
