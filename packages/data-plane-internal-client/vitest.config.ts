import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/integrations-core$/,
        replacement: fileURLToPath(new URL("../integrations-core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox-lifecycle$/,
        replacement: fileURLToPath(new URL("../sandbox-lifecycle/src/index.ts", import.meta.url)),
      },
    ],
    conditions: ["workspace-src", "node", "import", "default"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
