import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["system/**/*.system.test.ts"],
  },
});
