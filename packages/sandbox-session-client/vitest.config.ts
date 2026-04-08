import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/sandbox-session-protocol$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-protocol/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../time/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
