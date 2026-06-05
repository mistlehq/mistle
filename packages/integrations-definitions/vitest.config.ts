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
        find: /^@mistle\/integrations-core$/,
        replacement: fileURLToPath(new URL("../integrations-core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/http$/,
        replacement: fileURLToPath(new URL("../http/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox-session-client\/browser$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-client/src/browser.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/node$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-client/src/node.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-client/src/index.ts", import.meta.url),
        ),
      },
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
      {
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(new URL("../time/src/testing/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
