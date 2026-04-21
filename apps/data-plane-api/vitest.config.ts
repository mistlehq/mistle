import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "workflows/**/*.test.ts"],
    exclude: [
      "**/*.integration.test.ts",
      "src/**/*.property.test.ts",
      "workflows/**/*.property.test.ts",
    ],
  },
});
