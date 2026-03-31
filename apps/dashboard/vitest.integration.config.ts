import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

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
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex\/client$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/client.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/index.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex\/app-server$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/app-server.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/forms$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/forms/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/node$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/node.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/browser$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/browser.ts", import.meta.url),
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
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(
          new URL("../../packages/time/src/testing/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
      },
      {
        find: "ws",
        replacement: require.resolve("ws"),
      },
    ],
    tsconfigPaths: true,
  },
  test: {
    include: ["integration/**/*.integration.test.ts", "integration/**/*.integration.test.tsx"],
    setupFiles: ["./integration/setup-vitest.ts"],
  },
});
