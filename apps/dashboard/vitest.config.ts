import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/integrations-definitions$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/openai\/agent\/client$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/openai/agent.client.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/browser$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/browser.ts", import.meta.url),
        ),
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
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@pierre/diffs", "@pierre/theme"],
      },
    },
  },
});
