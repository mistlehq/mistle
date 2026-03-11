import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "workflows/**/*.test.ts"],
    exclude: [
      "src/**/*.property.test.ts",
      "scripts/**/*.property.test.ts",
      "workflows/**/*.property.test.ts",
    ],
  },
});
