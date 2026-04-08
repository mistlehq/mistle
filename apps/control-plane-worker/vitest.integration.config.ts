import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/integrations-definitions\/server$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/server.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["integration/**/*.integration.test.ts"],
    globalSetup: "./integration/global-setup.ts",
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
