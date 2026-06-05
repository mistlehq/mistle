import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
  },
  test: {
    include: ["openworkflow/**/*.test.ts", "runtime-state/**/*.test.ts"],
    exclude: ["openworkflow/**/*.property.test.ts", "runtime-state/**/*.property.test.ts"],
  },
});
