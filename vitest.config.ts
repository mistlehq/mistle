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
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("./packages/time/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(
          new URL("./packages/time/src/testing/index.ts", import.meta.url),
        ),
      },
    ],
    tsconfigPaths: true,
  },
});
