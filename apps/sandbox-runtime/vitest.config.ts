import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/integrations-core$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@mistle/integrations-definitions/agent",
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/agent.server.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/node$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/node.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-protocol$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox-rs-napi$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-rs-napi/dist/index.js", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
