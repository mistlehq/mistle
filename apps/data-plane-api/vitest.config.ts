import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
    alias: [
      {
        find: /^@mistle\/sandbox-lifecycle$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-lifecycle/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "workflows/**/*.test.ts"],
    exclude: [
      "**/*.integration.test.ts",
      "src/**/*.property.test.ts",
      "workflows/**/*.property.test.ts",
    ],
  },
});
