import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "openworkflow/**/*.test.ts"],
  },
});
