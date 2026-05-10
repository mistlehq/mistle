import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/config$/,
        replacement: fileURLToPath(new URL("../../packages/config/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/integrations-definitions\/server$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/server.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/sandbox-runtimes$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/sandbox-runtimes/index.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/logging$/,
        replacement: fileURLToPath(new URL("../../packages/logging/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(
          new URL("../../packages/time/src/testing/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "workflows/**/*.test.ts"],
    exclude: [
      "src/**/*.property.test.ts",
      "scripts/**/*.property.test.ts",
      "workflows/**/*.property.test.ts",
    ],
  },
});
