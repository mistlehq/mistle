import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["openworkflow/**/*.test.ts", "runtime-state/**/*.test.ts"],
    exclude: ["openworkflow/**/*.property.test.ts", "runtime-state/**/*.property.test.ts"],
  },
});
