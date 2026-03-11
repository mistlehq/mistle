import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: [
      "src/**/*.property.test.ts",
      "scripts/**/*.property.test.ts",
      "src/worker/**/*.test.ts",
    ],
  },
});
