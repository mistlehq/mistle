import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mistle/integrations-core": fileURLToPath(
        new URL("../../packages/integrations-core/src/index.ts", import.meta.url),
      ),
      "@mistle/sandbox-session-protocol": fileURLToPath(
        new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
