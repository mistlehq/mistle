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
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "workflows/**/*.test.ts"],
    exclude: [
      "src/**/*.property.test.ts",
      "scripts/**/*.property.test.ts",
      "workflows/**/*.property.test.ts",
    ],
  },
});
